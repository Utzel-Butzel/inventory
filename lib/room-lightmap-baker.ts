import * as THREE from "three";
import { FullScreenQuad } from "three/examples/jsm/postprocessing/Pass.js";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";

type PathTracingMaterial = THREE.ShaderMaterial & {
  bounces: number;
  transmissiveBounces: number;
};

type PathTracerInternals = {
  _pathTracer: {
    material: PathTracingMaterial;
    setSize: (width: number, height: number) => void;
    stableNoise: boolean;
  };
};

type BakeCacheEntry = {
  data: Float32Array;
  directionData: Float32Array;
  height: number;
  width: number;
};

type ReceiverMesh = THREE.Mesh<THREE.BufferGeometry, THREE.Material | THREE.Material[]>;

type UnwrappedReceiver = {
  geometry: THREE.BufferGeometry;
  mesh: ReceiverMesh;
  originalGeometry: THREE.BufferGeometry;
};

export type RoomLightMapBake = {
  readonly cached: boolean;
  readonly samples: number;
  dispose: () => void;
  finish: () => THREE.Texture;
  renderSample: () => void;
};

const lightMapCache = new Map<string, BakeCacheEntry>();
const maximumCachedLightMaps = 2;

export function createRoomLightMapCacheKey(value: unknown) {
  const source = JSON.stringify(value);
  let hash = 2_166_136_261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return `room-lightmap-v17-${(hash >>> 0).toString(36)}`;
}

function cacheLightMap(key: string, entry: BakeCacheEntry) {
  lightMapCache.delete(key);
  lightMapCache.set(key, entry);
  while (lightMapCache.size > maximumCachedLightMaps) {
    const oldestKey = lightMapCache.keys().next().value as string | undefined;
    if (!oldestKey) break;
    lightMapCache.delete(oldestKey);
  }
}

function isEffectivelyVisible(object: THREE.Object3D) {
  let candidate: THREE.Object3D | null = object;
  while (candidate) {
    if (!candidate.visible) return false;
    candidate = candidate.parent;
  }
  return true;
}

function receiverMaterial(
  material: THREE.Material,
): material is THREE.MeshStandardMaterial {
  return (
    material instanceof THREE.MeshStandardMaterial &&
    !material.transparent &&
    material.opacity >= 0.99
  );
}

function collectReceivers(roots: Iterable<THREE.Object3D>) {
  const receivers: ReceiverMesh[] = [];
  for (const root of roots) {
    root.traverse((object) => {
      if (
        !(object instanceof THREE.Mesh) ||
        object instanceof THREE.InstancedMesh ||
        object instanceof THREE.SkinnedMesh ||
        !isEffectivelyVisible(object)
      ) {
        return;
      }
      const materials = Array.isArray(object.material)
        ? object.material
        : [object.material];
      if (!materials.some(receiverMaterial)) return;
      const position = object.geometry.getAttribute("position");
      if (!position || position.count < 3) return;
      receivers.push(object as ReceiverMesh);
    });
  }
  return receivers;
}

function attributeAsFloat32(
  attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
) {
  const values = new Float32Array(attribute.count * attribute.itemSize);
  for (let vertex = 0; vertex < attribute.count; vertex += 1) {
    for (let component = 0; component < attribute.itemSize; component += 1) {
      values[vertex * attribute.itemSize + component] = attribute.getComponent(
        vertex,
        component,
      );
    }
  }
  return values;
}

function worldSpaceAtlasAttributes(
  mesh: ReceiverMesh,
  position: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
  normal: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
) {
  const positions = new Float32Array(position.count * 3);
  const normals = new Float32Array(normal.count * 3);
  const point = new THREE.Vector3();
  const direction = new THREE.Vector3();
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
  const texelScale = THREE.MathUtils.clamp(
    Number(mesh.userData.roomLightMapTexelScale) || 1,
    0.5,
    4,
  );

  // xatlas decides chart scale from the positions it receives. Furniture made
  // from unit cylinders/spheres and fitted AI groups is scaled by Object3D
  // transforms, so local-space input gives it the wrong texel density even
  // though the resulting UV coordinates are technically valid. Feed metric
  // world-space geometry to the unwrapper, while retaining the original local
  // attributes below for rendering.
  for (let vertex = 0; vertex < position.count; vertex += 1) {
    point
      .set(position.getX(vertex), position.getY(vertex), position.getZ(vertex))
      .applyMatrix4(mesh.matrixWorld)
      .multiplyScalar(texelScale)
      .toArray(positions, vertex * 3);
    direction
      .set(normal.getX(vertex), normal.getY(vertex), normal.getZ(vertex))
      .applyNormalMatrix(normalMatrix)
      .toArray(normals, vertex * 3);
  }

  return { normals, positions };
}

function copyAttributeForAtlas(
  attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
  originalVertexIndices: Uint32Array,
) {
  const values = new Float32Array(originalVertexIndices.length * attribute.itemSize);
  for (let vertex = 0; vertex < originalVertexIndices.length; vertex += 1) {
    const originalVertex = originalVertexIndices[vertex] ?? 0;
    for (let component = 0; component < attribute.itemSize; component += 1) {
      values[vertex * attribute.itemSize + component] = attribute.getComponent(
        originalVertex,
        component,
      );
    }
  }
  return new THREE.Float32BufferAttribute(values, attribute.itemSize, attribute.normalized);
}

function validateAtlasUvs(uvs: Float32Array) {
  for (let index = 0; index < uvs.length; index += 1) {
    const value = uvs[index];
    if (!Number.isFinite(value) || value < -0.001 || value > 1.001) {
      throw new Error(
        `xatlas returned an invalid normalized lightmap UV (${String(value)}).`,
      );
    }
  }
}

function addLightMapChartIds(
  geometry: THREE.BufferGeometry,
  firstChartId: number,
) {
  const position = geometry.getAttribute("position");
  const index = geometry.getIndex();
  if (!position || !index) return firstChartId;

  // xatlas duplicates vertices at chart seams. Connected components in its
  // output index buffer are therefore the UV islands we must keep isolated
  // while filtering the baked map.
  const parents = new Uint32Array(position.count);
  for (let vertex = 0; vertex < parents.length; vertex += 1) parents[vertex] = vertex;

  const find = (vertex: number) => {
    let root = vertex;
    while (parents[root] !== root) root = parents[root] ?? root;
    while (parents[vertex] !== vertex) {
      const parent = parents[vertex] ?? vertex;
      parents[vertex] = root;
      vertex = parent;
    }
    return root;
  };
  const union = (left: number, right: number) => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parents[rightRoot] = leftRoot;
  };

  for (let offset = 0; offset + 2 < index.count; offset += 3) {
    const a = index.getX(offset);
    const b = index.getX(offset + 1);
    const c = index.getX(offset + 2);
    union(a, b);
    union(a, c);
  }

  const roots = new Map<number, number>();
  const chartIds = new Float32Array(position.count);
  let nextChartId = firstChartId;
  for (let vertex = 0; vertex < position.count; vertex += 1) {
    const root = find(vertex);
    let chartId = roots.get(root);
    if (chartId === undefined) {
      chartId = nextChartId;
      nextChartId += 1;
      roots.set(root, chartId);
    }
    chartIds[vertex] = chartId;
  }
  geometry.setAttribute(
    "lightMapChart",
    new THREE.Float32BufferAttribute(chartIds, 1),
  );
  return nextChartId;
}

async function unwrapReceiverGeometry(receivers: ReceiverMesh[]) {
  const { default: createXAtlas } = await import("xatlas-web");
  const atlas = createXAtlas({
    locateFile: (path) =>
      path.endsWith(".wasm")
        ? new URL("/xatlas-web.wasm", window.location.origin).toString()
        : path,
  });
  await atlas.ready;

  type AtlasInput = {
    geometry: THREE.BufferGeometry;
    mesh: ReceiverMesh;
    meshId: number;
    originalGeometry: THREE.BufferGeometry;
  };
  const inputs: AtlasInput[] = [];
  atlas.createAtlas();
  try {
    for (const mesh of receivers) {
      const originalGeometry = mesh.geometry;
      let geometry = originalGeometry.clone();
      if (!geometry.getAttribute("normal")) geometry.computeVertexNormals();

      // ExtrudeGeometry is deliberately non-indexed. Passing it straight to
      // xatlas makes each coplanar triangle around a window an independent UV
      // island, so normal sampling and denoising stop at its triangulation
      // edges. Weld vertices that already agree in position, normal, and UV;
      // hard wall/cap edges remain split because their normals differ.
      if (!geometry.getIndex()) {
        const indexedGeometry = mergeVertices(geometry, 1e-5);
        geometry.dispose();
        geometry = indexedGeometry;
      }

      const position = geometry.getAttribute("position");
      const normal = geometry.getAttribute("normal");
      if (!position || !normal || position.count > 65_535) continue;

      const sourceUv = geometry.getAttribute("uv");
      const uv = sourceUv
        ? attributeAsFloat32(sourceUv)
        : new Float32Array(position.count * 2);
      const atlasAttributes = worldSpaceAtlasAttributes(
        mesh,
        position,
        normal,
      );
      const sourceIndex = geometry.getIndex();
      const indexCount = sourceIndex?.count ?? position.count;
      const indices = new Uint16Array(indexCount);
      for (let index = 0; index < indexCount; index += 1) {
        const vertex = sourceIndex?.getX(index) ?? index;
        if (vertex > 65_535) throw new Error("A room mesh exceeds the lightmap UV limit.");
        indices[index] = vertex;
      }

      const meshInfo = atlas.createMesh(position.count, indexCount, true, true);
      atlas.HEAPU16.set(
        indices,
        meshInfo.indexOffset / Uint16Array.BYTES_PER_ELEMENT,
      );
      atlas.HEAPF32.set(
        atlasAttributes.positions,
        meshInfo.positionOffset / Float32Array.BYTES_PER_ELEMENT,
      );
      atlas.HEAPF32.set(
        atlasAttributes.normals,
        meshInfo.normalOffset / Float32Array.BYTES_PER_ELEMENT,
      );
      atlas.HEAPF32.set(
        uv,
        meshInfo.uvOffset / Float32Array.BYTES_PER_ELEMENT,
      );
      const status = atlas.addMesh();
      if (status !== 0) throw new Error(`xatlas could not add a room mesh (${status}).`);
      inputs.push({ geometry, mesh, meshId: meshInfo.meshId, originalGeometry });
    }

    if (!inputs.length) throw new Error("The room has no opaque meshes to lightmap.");
    atlas.generateAtlas();

    const results: UnwrappedReceiver[] = [];
    let nextChartId = 1;
    for (const input of inputs) {
      const meshData = atlas.getMeshData(input.meshId);
      const originalVertexIndices = new Uint32Array(
        atlas.HEAPU32.buffer,
        meshData.originalIndexOffset,
        meshData.newVertexCount,
      ).slice();
      const atlasIndices = new Uint32Array(
        atlas.HEAPU32.buffer,
        meshData.indexOffset,
        meshData.newIndexCount,
      ).slice();
      const atlasUvs = new Float32Array(
        atlas.HEAPF32.buffer,
        meshData.uvOffset,
        meshData.newVertexCount * 2,
      ).slice();
      validateAtlasUvs(atlasUvs);

      const output = new THREE.BufferGeometry();
      for (const [name, attribute] of Object.entries(input.geometry.attributes)) {
        output.setAttribute(
          name,
          copyAttributeForAtlas(attribute, originalVertexIndices),
        );
      }
      output.setAttribute("uv1", new THREE.Float32BufferAttribute(atlasUvs, 2));
      output.setIndex(new THREE.Uint32BufferAttribute(atlasIndices, 1));
      nextChartId = addLightMapChartIds(output, nextChartId);
      for (const group of input.geometry.groups) {
        output.addGroup(group.start, group.count, group.materialIndex);
      }
      output.drawRange = { ...input.geometry.drawRange };
      output.computeBoundingBox();
      output.computeBoundingSphere();
      results.push({
        geometry: output,
        mesh: input.mesh,
        originalGeometry: input.originalGeometry,
      });
      input.geometry.dispose();
    }
    return results;
  } finally {
    atlas.destroyAtlas();
  }
}

function createGeometryBufferMaterial(kind: "normal" | "position") {
  return new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    depthTest: false,
    depthWrite: false,
    blending: THREE.NoBlending,
    vertexShader: `
      attribute vec2 uv1;
      varying vec3 vBakeValue;
      void main() {
        ${kind === "position"
          ? "vBakeValue = (modelMatrix * vec4(position, 1.0)).xyz;"
          : "vBakeValue = normalize(normalMatrix * normal);"}
        gl_Position = vec4(uv1 * 2.0 - 1.0, 0.0, 1.0);
      }
    `,
    fragmentShader: `
      varying vec3 vBakeValue;
      void main() {
        gl_FragColor = vec4(vBakeValue, 1.0);
      }
    `,
  });
}

function createChartBufferMaterial() {
  return new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    depthTest: false,
    depthWrite: false,
    blending: THREE.NoBlending,
    vertexShader: `
      attribute vec2 uv1;
      attribute float lightMapChart;
      varying float vLightMapChart;
      void main() {
        vLightMapChart = lightMapChart;
        gl_Position = vec4(uv1 * 2.0 - 1.0, 0.0, 1.0);
      }
    `,
    fragmentShader: `
      varying float vLightMapChart;
      void main() {
        gl_FragColor = vec4(vLightMapChart, 0.0, 0.0, 1.0);
      }
    `,
  });
}

function createGeometryBuffers(
  renderer: THREE.WebGLRenderer,
  receivers: UnwrappedReceiver[],
  resolution: number,
) {
  const options: THREE.RenderTargetOptions = {
    type: THREE.FloatType,
    format: THREE.RGBAFormat,
    magFilter: THREE.NearestFilter,
    minFilter: THREE.NearestFilter,
    depthBuffer: false,
    stencilBuffer: false,
    generateMipmaps: false,
  };
  const positionTarget = new THREE.WebGLRenderTarget(resolution, resolution, options);
  const normalTarget = new THREE.WebGLRenderTarget(resolution, resolution, options);
  const chartTarget = new THREE.WebGLRenderTarget(resolution, resolution, options);
  const bakeScene = new THREE.Scene();
  for (const { mesh } of receivers) {
    const clone = new THREE.Mesh(mesh.geometry, mesh.material);
    clone.matrixAutoUpdate = false;
    clone.matrix.copy(mesh.matrixWorld);
    bakeScene.add(clone);
  }
  const bakeCamera = new THREE.Camera();
  const positionMaterial = createGeometryBufferMaterial("position");
  const normalMaterial = createGeometryBufferMaterial("normal");
  const chartMaterial = createChartBufferMaterial();
  const previousTarget = renderer.getRenderTarget();
  const previousClearAlpha = renderer.getClearAlpha();
  const previousClearColor = renderer.getClearColor(new THREE.Color());
  const previousAutoClear = renderer.autoClear;
  const previousToneMapping = renderer.toneMapping;
  renderer.autoClear = true;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.setClearColor(0x000000, 0);
  try {
    bakeScene.overrideMaterial = positionMaterial;
    renderer.setRenderTarget(positionTarget);
    renderer.clear();
    renderer.render(bakeScene, bakeCamera);
    bakeScene.overrideMaterial = normalMaterial;
    renderer.setRenderTarget(normalTarget);
    renderer.clear();
    renderer.render(bakeScene, bakeCamera);
    bakeScene.overrideMaterial = chartMaterial;
    renderer.setRenderTarget(chartTarget);
    renderer.clear();
    renderer.render(bakeScene, bakeCamera);
  } finally {
    renderer.setRenderTarget(previousTarget);
    renderer.setClearColor(previousClearColor, previousClearAlpha);
    renderer.autoClear = previousAutoClear;
    renderer.toneMapping = previousToneMapping;
    positionMaterial.dispose();
    normalMaterial.dispose();
    chartMaterial.dispose();
  }
  return { chartTarget, normalTarget, positionTarget };
}

function patchPathTracingMaterial(
  material: PathTracingMaterial,
  positionMap: THREE.Texture,
  normalMap: THREE.Texture,
) {
  // PhysicalPathTracingMaterial already sits at the WebGL minimum of sixteen
  // fragment samplers. A lightmap bake has no visible background or environment,
  // so reuse those two allocated sampler slots for the surface G-buffer instead
  // of requiring hardware with more than MAX_TEXTURE_IMAGE_UNITS=16.
  material.uniforms.backgroundMap!.value = positionMap;
  const environmentInfo = material.uniforms.envMapInfo!.value as {
    map: THREE.Texture;
  };
  environmentInfo.map = normalMap;
  const replaceShaderChunk = (
    source: string,
    search: string,
    replacement: string,
    label: string,
  ) => {
    const first = source.indexOf(search);
    if (first < 0) {
      throw new Error(`The room lightmap shader is missing its ${label} anchor.`);
    }
    if (source.indexOf(search, first + search.length) >= 0) {
      throw new Error(`The room lightmap shader has more than one ${label} anchor.`);
    }
    return source.replace(search, replacement);
  };

  let fragmentShader = material.fragmentShader;
  fragmentShader = replaceShaderChunk(
    fragmentShader,
    "Ray ray = getCameraRay();",
    `vec4 lightMapPositionSample = texture2D(backgroundMap, vUv);
       if (lightMapPositionSample.a < 0.5) {
         gl_FragColor = vec4(0.0);
         return;
       }
       vec3 lightMapNormal = normalize(texture2D(envMapInfo.map, vUv).xyz);
       vec2 hemisphereSample = rand2(12);
       float hemisphereRadius = sqrt(hemisphereSample.x);
       float hemisphereAngle = 2.0 * PI * hemisphereSample.y;
       float hemisphereCosine = sqrt(max(0.0, 1.0 - hemisphereSample.x));
       vec3 lightMapTangent = normalize(
         abs(lightMapNormal.z) < 0.999
           ? cross(vec3(0.0, 0.0, 1.0), lightMapNormal)
           : cross(vec3(0.0, 1.0, 0.0), lightMapNormal)
       );
       vec3 lightMapBitangent = cross(lightMapNormal, lightMapTangent);
       Ray ray;
       ray.direction = normalize(
         lightMapTangent * cos(hemisphereAngle) * hemisphereRadius +
         lightMapBitangent * sin(hemisphereAngle) * hemisphereRadius +
         lightMapNormal * hemisphereCosine
       );
       ray.origin = stepRayOrigin(
         lightMapPositionSample.xyz,
         ray.direction,
         lightMapNormal,
         0.0
       );
       float lightMapInitialPdf = hemisphereCosine * RECIPROCAL_PI;`,
    "camera ray",
  );
  fragmentShader = replaceShaderChunk(
    fragmentShader,
    "ScatterRecord scatterRec;",
    `ScatterRecord scatterRec;
       scatterRec.pdf = max(lightMapInitialPdf, 1e-6);
       scatterRec.specularPdf = 0.0;
       scatterRec.direction = ray.direction;
       scatterRec.color = vec3(1.0);`,
    "scatter initialization",
  );
  fragmentShader = replaceShaderChunk(
    fragmentShader,
    "state.transmissiveTraversals = transmissiveBounces;",
    `state.transmissiveTraversals = transmissiveBounces;
       state.transmissiveRay = false;

       // Explicitly sample the window emitter at the baked surface. Relying
       // only on a cosine ray randomly finding the window converges too slowly
       // and produces bright, isolated light hits. The initial forward light
       // hit is disabled below, so this direct sample carries the full weight.
       state.traversals = bounces;
       state.isShadowRay = true;
       if (lights.count != 0u) {
         LightRecord lightMapLight = randomLightSample(
           lights.tex,
           iesProfiles,
           lights.count,
           ray.origin,
           rand3(13)
         );
         float lightMapCosine = max(
           dot(lightMapNormal, lightMapLight.direction),
           0.0
         );
         float lightMapLightPdf = lightMapLight.pdf / max(
           float(lights.count),
           1.0
         );
         if (lightMapCosine > 0.0 && lightMapLightPdf > 0.0) {
           Ray lightMapShadowRay;
           lightMapShadowRay.origin = ray.origin;
           lightMapShadowRay.direction = lightMapLight.direction;
           vec3 lightMapAttenuation;
           if (!attenuateHit(
             state,
             lightMapShadowRay,
             lightMapLight.dist,
             lightMapAttenuation
           )) {
             gl_FragColor.rgb +=
               lightMapAttenuation *
               lightMapLight.emission *
               lightMapCosine *
               RECIPROCAL_PI /
               lightMapLightPdf;
           }
         }
       }
       state.isShadowRay = false;`,
    "path state",
  );
  fragmentShader = replaceShaderChunk(
    fragmentShader,
    "state.firstRay = i == 0 && state.transmissiveTraversals == transmissiveBounces;",
    "state.firstRay = false;",
    "first ray",
  );
  fragmentShader = replaceShaderChunk(
    fragmentShader,
    "if ( ! state.firstRay && ! state.transmissiveRay ) {",
    "if ( i > 0 && ! state.transmissiveRay ) {",
    "forward light hit",
  );
  fragmentShader = replaceShaderChunk(
    fragmentShader,
    "gl_FragColor.a *= opacity;",
    `// The first direction is sampled with a cosine-weighted hemisphere.
       // Multiplying its returned radiance by PI converts it to the diffuse
       // irradiance expected by MeshStandardMaterial.lightMap. Keep the HDR
       // result unclamped; display exposure and AgX own highlight compression.
       gl_FragColor.rgb = max(gl_FragColor.rgb * PI, vec3(0.0));
       gl_FragColor.a = lightMapPositionSample.a * opacity;`,
    "lightmap output",
  );
  material.fragmentShader = fragmentShader;
  material.needsUpdate = true;
}

function createDenoiseMaterial() {
  return new THREE.ShaderMaterial({
    depthTest: false,
    depthWrite: false,
    blending: THREE.NoBlending,
    uniforms: {
      map: { value: null as THREE.Texture | null },
      chartMap: { value: null as THREE.Texture | null },
      normalMap: { value: null as THREE.Texture | null },
      positionMap: { value: null as THREE.Texture | null },
      stepWidth: { value: 1 },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D map;
      uniform sampler2D chartMap;
      uniform sampler2D normalMap;
      uniform sampler2D positionMap;
      uniform float stepWidth;
      varying vec2 vUv;
      void main() {
        vec2 texel = 1.0 / vec2(textureSize(map, 0));
        vec4 center = texture2D(map, vUv);
        vec4 centerPosition = texture2D(positionMap, vUv);
        if (centerPosition.a < 0.5) {
          gl_FragColor = vec4(0.0);
          return;
        }
        float centerChart = texture2D(chartMap, vUv).r;
        vec3 centerNormal = normalize(texture2D(normalMap, vUv).xyz);
        vec3 total = vec3(0.0);
        float totalWeight = 0.0;
        for (int y = -1; y <= 1; y++) {
          for (int x = -1; x <= 1; x++) {
            vec2 sampleUv = vUv + vec2(float(x), float(y)) * texel * stepWidth;
            vec4 sampleColor = texture2D(map, sampleUv);
            vec4 samplePosition = texture2D(positionMap, sampleUv);
            if (sampleColor.a <= 0.0 || samplePosition.a < 0.5) continue;
            float sampleChart = texture2D(chartMap, sampleUv).r;
            if (abs(centerChart - sampleChart) > 0.25) continue;
            vec3 sampleNormal = normalize(texture2D(normalMap, sampleUv).xyz);
            float normalWeight = pow(max(dot(centerNormal, sampleNormal), 0.0), 16.0);
            float positionWeight = exp(-length(centerPosition.xyz - samplePosition.xyz) * 8.0);
            float spatialWeight = exp(-float(x * x + y * y) * 0.22);
            float centerLuminance = dot(center.rgb, vec3(0.2126, 0.7152, 0.0722));
            float sampleLuminance = dot(sampleColor.rgb, vec3(0.2126, 0.7152, 0.0722));
            float luminanceScale = max(
              max(centerLuminance, sampleLuminance),
              0.08
            );
            float luminanceWeight = exp(
              -abs(centerLuminance - sampleLuminance) /
              luminanceScale * 4.0
            );
            float weight =
              normalWeight * positionWeight * spatialWeight * luminanceWeight;
            total += sampleColor.rgb * weight;
            totalWeight += weight;
          }
        }
        gl_FragColor = vec4(
          totalWeight > 0.0 ? total / totalWeight : center.rgb,
          1.0
        );
      }
    `,
  });
}

function createFireflyFilterMaterial() {
  return new THREE.ShaderMaterial({
    depthTest: false,
    depthWrite: false,
    blending: THREE.NoBlending,
    uniforms: {
      map: { value: null as THREE.Texture | null },
      chartMap: { value: null as THREE.Texture | null },
      normalMap: { value: null as THREE.Texture | null },
      positionMap: { value: null as THREE.Texture | null },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D map;
      uniform sampler2D chartMap;
      uniform sampler2D normalMap;
      uniform sampler2D positionMap;
      varying vec2 vUv;

      float lightMapLuminance(vec3 color) {
        return dot(color, vec3(0.2126, 0.7152, 0.0722));
      }

      void main() {
        vec4 center = texture2D(map, vUv);
        vec4 centerPosition = texture2D(positionMap, vUv);
        if (centerPosition.a < 0.5) {
          gl_FragColor = vec4(0.0);
          return;
        }

        vec2 texel = 1.0 / vec2(textureSize(map, 0));
        float centerChart = texture2D(chartMap, vUv).r;
        vec3 centerNormal = normalize(texture2D(normalMap, vUv).xyz);
        float centerLuminance = lightMapLuminance(center.rgb);
        float neighborTotal = 0.0;
        float neighborSquaredTotal = 0.0;
        float neighborWeight = 0.0;

        for (int y = -1; y <= 1; y++) {
          for (int x = -1; x <= 1; x++) {
            if (x == 0 && y == 0) continue;
            vec2 sampleUv = vUv + vec2(float(x), float(y)) * texel;
            vec4 samplePosition = texture2D(positionMap, sampleUv);
            if (samplePosition.a < 0.5) continue;
            float sampleChart = texture2D(chartMap, sampleUv).r;
            if (abs(centerChart - sampleChart) > 0.25) continue;
            vec3 sampleNormal = normalize(texture2D(normalMap, sampleUv).xyz);
            if (dot(centerNormal, sampleNormal) < 0.92) continue;
            float sampleLuminance = lightMapLuminance(
              texture2D(map, sampleUv).rgb
            );
            neighborTotal += sampleLuminance;
            neighborSquaredTotal += sampleLuminance * sampleLuminance;
            neighborWeight += 1.0;
          }
        }

        vec3 filtered = center.rgb;
        if (neighborWeight >= 3.0) {
          float mean = neighborTotal / neighborWeight;
          float variance = max(
            neighborSquaredTotal / neighborWeight - mean * mean,
            0.0
          );
          float maximumLuminance = mean + max(3.0 * sqrt(variance), 0.18);
          if (centerLuminance > maximumLuminance) {
            filtered *= maximumLuminance / max(centerLuminance, 1e-6);
          }
        }
        gl_FragColor = vec4(filtered, 1.0);
      }
    `,
  });
}

function createDilationMaterial() {
  return new THREE.ShaderMaterial({
    depthTest: false,
    depthWrite: false,
    blending: THREE.NoBlending,
    uniforms: { map: { value: null as THREE.Texture | null } },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D map;
      varying vec2 vUv;
      void main() {
        vec4 center = texture2D(map, vUv);
        if (center.a > 0.0) {
          gl_FragColor = center;
          return;
        }
        vec2 texel = 1.0 / vec2(textureSize(map, 0));
        vec4 nearest = vec4(0.0);
        float nearestDistance = 1e10;
        for (int y = -2; y <= 2; y++) {
          for (int x = -2; x <= 2; x++) {
            vec4 sampleColor = texture2D(
              map,
              vUv + vec2(float(x), float(y)) * texel
            );
            if (sampleColor.a <= 0.0) continue;
            float distanceSquared = float(x * x + y * y);
            if (distanceSquared < nearestDistance) {
              nearest = sampleColor;
              nearestDistance = distanceSquared;
            }
          }
        }
        gl_FragColor = nearest;
      }
    `,
  });
}

function createLightMapTarget(resolution: number) {
  const target = new THREE.WebGLRenderTarget(resolution, resolution, {
    type: THREE.FloatType,
    format: THREE.RGBAFormat,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: false,
    stencilBuffer: false,
    generateMipmaps: false,
  });
  target.texture.wrapS = THREE.ClampToEdgeWrapping;
  target.texture.wrapT = THREE.ClampToEdgeWrapping;
  target.texture.colorSpace = THREE.NoColorSpace;
  return target;
}

function collectDirectionalBakeLights(scene: THREE.Scene) {
  const lights: Array<{
    position: THREE.Vector3;
    power: number;
  }> = [];
  scene.updateMatrixWorld(true);
  scene.traverse((object) => {
    if (
      !(object instanceof THREE.RectAreaLight) ||
      !isEffectivelyVisible(object) ||
      object.intensity <= 0
    ) {
      return;
    }
    const luminance =
      object.color.r * 0.2126 +
      object.color.g * 0.7152 +
      object.color.b * 0.0722;
    lights.push({
      position: object.getWorldPosition(new THREE.Vector3()),
      power: Math.max(
        object.intensity * object.width * object.height * luminance,
        0,
      ),
    });
  });
  return lights
    .sort((left, right) => right.power - left.power)
    .slice(0, 8);
}

function createDirectionalLightMap(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  positionMap: THREE.Texture,
  normalMap: THREE.Texture,
  resolution: number,
) {
  const lights = collectDirectionalBakeLights(scene);
  const lightPositions = Array.from(
    { length: 8 },
    (_, index) => lights[index]?.position ?? new THREE.Vector3(),
  );
  const lightPowers = Array.from(
    { length: 8 },
    (_, index) => lights[index]?.power ?? 0,
  );
  const material = new THREE.ShaderMaterial({
    depthTest: false,
    depthWrite: false,
    blending: THREE.NoBlending,
    uniforms: {
      positionMap: { value: positionMap },
      normalMap: { value: normalMap },
      lightCount: { value: lights.length },
      lightPositions: { value: lightPositions },
      lightPowers: { value: lightPowers },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D positionMap;
      uniform sampler2D normalMap;
      uniform int lightCount;
      uniform vec3 lightPositions[8];
      uniform float lightPowers[8];
      varying vec2 vUv;

      void main() {
        vec4 positionSample = texture2D(positionMap, vUv);
        if (positionSample.a < 0.5) {
          gl_FragColor = vec4(0.0);
          return;
        }
        vec3 surfaceNormal = normalize(texture2D(normalMap, vUv).xyz);
        vec3 directionSum = vec3(0.0);
        float weightSum = 0.0;
        for (int index = 0; index < 8; index++) {
          if (index >= lightCount) break;
          vec3 toLight = lightPositions[index] - positionSample.xyz;
          float distanceSquared = max(dot(toLight, toLight), 0.04);
          vec3 lightDirection = normalize(toLight);
          float cosine = max(dot(surfaceNormal, lightDirection), 0.0);
          float weight = lightPowers[index] * cosine / distanceSquared;
          directionSum += lightDirection * weight;
          weightSum += weight;
        }
        if (weightSum <= 1e-6 || length(directionSum) <= 1e-6) {
          gl_FragColor = vec4(surfaceNormal * 0.5 + 0.5, 0.0);
          return;
        }
        float coherence = clamp(length(directionSum) / weightSum, 0.0, 1.0);
        vec3 dominantDirection = normalize(directionSum);
        // Direction only reconstructs the response of normal-mapped detail;
        // the converged HDR atlas remains authoritative for total energy.
        gl_FragColor = vec4(
          dominantDirection * 0.5 + 0.5,
          min(coherence * 0.55, 0.55)
        );
      }
    `,
  });
  const targetA = createLightMapTarget(resolution);
  const targetB = createLightMapTarget(resolution);
  targetA.texture.colorSpace = THREE.NoColorSpace;
  targetB.texture.colorSpace = THREE.NoColorSpace;
  const quad = new FullScreenQuad(material);
  const dilationMaterial = createDilationMaterial();
  const dilationQuad = new FullScreenQuad(dilationMaterial);
  const previousTarget = renderer.getRenderTarget();
  const previousToneMapping = renderer.toneMapping;
  renderer.toneMapping = THREE.NoToneMapping;
  try {
    renderer.setRenderTarget(targetA);
    quad.render(renderer);
    let readTarget = targetA;
    let writeTarget = targetB;
    for (let pass = 0; pass < 4; pass += 1) {
      dilationMaterial.uniforms.map!.value = readTarget.texture;
      renderer.setRenderTarget(writeTarget);
      dilationQuad.render(renderer);
      [readTarget, writeTarget] = [writeTarget, readTarget];
    }
    writeTarget.dispose();
    return readTarget;
  } finally {
    renderer.setRenderTarget(previousTarget);
    renderer.toneMapping = previousToneMapping;
    quad.dispose();
    material.dispose();
    dilationQuad.dispose();
    dilationMaterial.dispose();
  }
}

function keepEnvironmentSpecularOnly(
  material: THREE.MeshStandardMaterial,
  directionalTexture: THREE.Texture,
) {
  material.userData.roomDirectionalLightMap = directionalTexture;
  if (material.userData.roomLightMapSpecularIbl) return;
  material.userData.roomLightMapSpecularIbl = true;
  const previousOnBeforeCompile = material.onBeforeCompile.bind(material);
  const previousProgramCacheKey = material.customProgramCacheKey.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    previousOnBeforeCompile(shader, renderer);
    shader.uniforms.roomDirectionalLightMap = {
      value: material.userData.roomDirectionalLightMap as THREE.Texture,
    };
    const mainAnchor = "void main() {";
    if (!shader.fragmentShader.includes(mainAnchor)) {
      throw new Error("The lightmapped material shader has no main function.");
    }
    shader.fragmentShader = shader.fragmentShader.replace(
      mainAnchor,
      `uniform sampler2D roomDirectionalLightMap;
      ${mainAnchor}`,
    );
    // onBeforeCompile runs before Three expands ShaderChunk includes. Patch
    // the installed light-map chunk, then inline it at its include site. This
    // keeps the hook aligned with the exact Three version used by the app and
    // also works for the physical material's transmission pre-pass.
    const lightMapInclude = "#include <lights_fragment_maps>";
    const bakedIrradianceAnchor = "irradiance += lightMapIrradiance;";
    const installedLightMapChunk = THREE.ShaderChunk.lights_fragment_maps;
    if (
      !shader.fragmentShader.includes(lightMapInclude) ||
      !installedLightMapChunk.includes(bakedIrradianceAnchor)
    ) {
      throw new Error("The lightmapped material shader has no irradiance anchor.");
    }
    const directionalLightMapChunk = installedLightMapChunk.replace(
      bakedIrradianceAnchor,
      `vec4 roomDirectionalSample = texture2D(
          roomDirectionalLightMap,
          vLightMapUv
        );
        if (roomDirectionalSample.a > 0.001) {
          vec3 roomDominantDirection = normalize(
            roomDirectionalSample.rgb * 2.0 - 1.0
          );
          vec3 roomDominantViewDirection = normalize(
            mat3(viewMatrix) * roomDominantDirection
          );
          float roomGeometryResponse = max(
            dot(geometryNormal, roomDominantViewDirection),
            0.08
          );
          float roomShadingResponse = max(
            dot(normal, roomDominantViewDirection),
            0.0
          );
          float roomDirectionalRatio = clamp(
            roomShadingResponse / roomGeometryResponse,
            0.35,
            1.65
          );
          lightMapIrradiance *= mix(
            1.0,
            roomDirectionalRatio,
            roomDirectionalSample.a
          );
        }
        ${bakedIrradianceAnchor}`,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      lightMapInclude,
      directionalLightMapChunk,
    );
    const environmentDiffuse =
      "vec3 indirectDiffuse = diffuse * cosineWeightedIrradiance;";
    // Three can compile the same physical material for auxiliary passes (most
    // notably the transmission pre-pass). Patch only lit variants containing
    // the physical environment lobe. Keeping iblIrradiance intact preserves
    // sheen and rough-specular multiscattering; only its duplicate diffuse term
    // is removed when the material already has baked irradiance.
    const physicalParsInclude = "#include <lights_physical_pars_fragment>";
    const installedPhysicalPars =
      THREE.ShaderChunk.lights_physical_pars_fragment;
    if (
      shader.fragmentShader.includes(physicalParsInclude) &&
      installedPhysicalPars.includes(environmentDiffuse)
    ) {
      const lightmappedPhysicalPars = installedPhysicalPars.replace(
        environmentDiffuse,
        `#ifdef USE_LIGHTMAP
          vec3 indirectDiffuse = vec3(0.0);
        #else
          ${environmentDiffuse}
        #endif`,
      );
      shader.fragmentShader = shader.fragmentShader.replace(
        physicalParsInclude,
        lightmappedPhysicalPars,
      );
    }
  };
  material.customProgramCacheKey = () =>
    `${previousProgramCacheKey()}|room-directional-lightmap-v1`;
}

function applyLightMap(
  receivers: UnwrappedReceiver[],
  texture: THREE.Texture,
  directionalTexture: THREE.Texture,
) {
  texture.channel = 1;
  texture.flipY = false;
  texture.colorSpace = THREE.LinearSRGBColorSpace;
  directionalTexture.flipY = false;
  directionalTexture.colorSpace = THREE.NoColorSpace;
  const materials = new Set<THREE.MeshStandardMaterial>();
  for (const { mesh } of receivers) {
    const meshMaterials = Array.isArray(mesh.material)
      ? mesh.material
      : [mesh.material];
    for (const material of meshMaterials) {
      if (receiverMaterial(material)) materials.add(material);
    }
  }
  for (const material of materials) {
    keepEnvironmentSpecularOnly(material, directionalTexture);
    material.lightMap = texture;
    material.lightMapIntensity = 1;
    material.needsUpdate = true;
  }
}

function cachedTexture(
  data: Float32Array,
  width: number,
  height: number,
  colorSpace: THREE.ColorSpace,
) {
  const texture = new THREE.DataTexture(
    data,
    width,
    height,
    THREE.RGBAFormat,
    THREE.FloatType,
  );
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.generateMipmaps = false;
  texture.colorSpace = colorSpace;
  texture.needsUpdate = true;
  return texture;
}

export async function createRoomLightMapBake({
  bakeOnlyObjects = [],
  cacheKey,
  onProgress,
  renderer,
  resolution = 1024,
  roots,
  scene,
}: {
  bakeOnlyObjects?: Iterable<THREE.Object3D>;
  cacheKey: string;
  onProgress?: (progress: number) => void;
  renderer: THREE.WebGLRenderer;
  resolution?: number;
  roots: Iterable<THREE.Object3D>;
  scene: THREE.Scene;
}): Promise<RoomLightMapBake> {
  onProgress?.(2);
  scene.updateMatrixWorld(true);
  const receivers = collectReceivers(roots);
  const unwrapped = await unwrapReceiverGeometry(receivers);
  for (const receiver of unwrapped) receiver.mesh.geometry = receiver.geometry;
  scene.updateMatrixWorld(true);
  onProgress?.(8);

  const cached = lightMapCache.get(cacheKey);
  if (cached && cached.width === resolution && cached.height === resolution) {
    const texture = cachedTexture(
      cached.data,
      cached.width,
      cached.height,
      THREE.LinearSRGBColorSpace,
    );
    const directionalTexture = cachedTexture(
      cached.directionData,
      cached.width,
      cached.height,
      THREE.NoColorSpace,
    );
    applyLightMap(unwrapped, texture, directionalTexture);
    onProgress?.(100);
    return {
      cached: true,
      samples: Number.POSITIVE_INFINITY,
      dispose: () => {
        directionalTexture.dispose();
        for (const { originalGeometry } of unwrapped) originalGeometry.dispose();
      },
      finish: () => texture,
      renderSample: () => undefined,
    };
  }

  const { chartTarget, normalTarget, positionTarget } = createGeometryBuffers(
    renderer,
    unwrapped,
    resolution,
  );
  const directionalTarget = createDirectionalLightMap(
    renderer,
    scene,
    positionTarget.texture,
    normalTarget.texture,
    resolution,
  );
  onProgress?.(12);

  const { WebGLPathTracer } = await import("three-gpu-pathtracer");
  const tracer = new WebGLPathTracer(renderer);
  tracer.bounces = 8;
  tracer.transmissiveBounces = 4;
  // Match the interactive Rendering reference so the two modes differ by
  // storage/reconstruction rather than a separate glossy-path bias.
  tracer.filterGlossyFactor = 0.85;
  tracer.multipleImportanceSampling = true;
  tracer.tiles.set(2, 2);
  tracer.renderDelay = 0;
  tracer.minSamples = 1;
  tracer.dynamicLowRes = false;
  tracer.rasterizeScene = false;
  tracer.renderToCanvas = false;
  tracer.synchronizeRenderSize = false;
  tracer.textureSize.set(resolution, resolution);
  // The HDR RoomEnvironment is useful for runtime reflections but its diffuse
  // component must not be baked a second time. The shader also reuses the
  // background/environment sampler slots for position and normal G-buffers, so
  // build the tracer with both sources explicitly disabled.
  const previousBackground = scene.background;
  const previousEnvironment = scene.environment;
  const previousEnvironmentIntensity = scene.environmentIntensity;
  const bakeOnly = [...bakeOnlyObjects];
  const bakeOnlyVisibility = bakeOnly.map((object) => object.visible);
  try {
    scene.background = null;
    scene.environment = null;
    scene.environmentIntensity = 0;
    bakeOnly.forEach((object) => {
      object.visible = true;
    });
    scene.updateMatrixWorld(true);
    tracer.setScene(scene, new THREE.PerspectiveCamera(), {
      onProgress: (progress) => onProgress?.(12 + Math.round(progress * 8)),
    });
  } finally {
    scene.background = previousBackground;
    scene.environment = previousEnvironment;
    scene.environmentIntensity = previousEnvironmentIntensity;
    bakeOnly.forEach((object, index) => {
      object.visible = bakeOnlyVisibility[index] ?? false;
    });
    scene.updateMatrixWorld(true);
  }
  const internals = tracer as unknown as PathTracerInternals;
  internals._pathTracer.setSize(resolution, resolution);
  internals._pathTracer.stableNoise = false;
  patchPathTracingMaterial(
    internals._pathTracer.material,
    positionTarget.texture,
    normalTarget.texture,
  );
  onProgress?.(20);

  let appliedTexture: THREE.Texture | null = null;
  let retainedTarget: THREE.WebGLRenderTarget | null = null;
  let finished = false;
  let disposed = false;

  const finish = () => {
    if (appliedTexture) return appliedTexture;
    if (disposed) throw new Error("The room lightmap bake has already been disposed.");

    const denoiseTarget = createLightMapTarget(resolution);
    const workTarget = createLightMapTarget(resolution);
    const denoiseMaterial = createDenoiseMaterial();
    denoiseMaterial.uniforms.chartMap!.value = chartTarget.texture;
    denoiseMaterial.uniforms.normalMap!.value = normalTarget.texture;
    denoiseMaterial.uniforms.positionMap!.value = positionTarget.texture;
    const denoiseQuad = new FullScreenQuad(denoiseMaterial);
    const previousTarget = renderer.getRenderTarget();
    const previousToneMapping = renderer.toneMapping;
    renderer.toneMapping = THREE.NoToneMapping;
    const fireflyMaterial = createFireflyFilterMaterial();
    fireflyMaterial.uniforms.map!.value = tracer.target.texture;
    fireflyMaterial.uniforms.chartMap!.value = chartTarget.texture;
    fireflyMaterial.uniforms.normalMap!.value = normalTarget.texture;
    fireflyMaterial.uniforms.positionMap!.value = positionTarget.texture;
    const fireflyQuad = new FullScreenQuad(fireflyMaterial);
    renderer.setRenderTarget(denoiseTarget);
    fireflyQuad.render(renderer);

    let denoiseSource = denoiseTarget.texture;
    let readTarget = denoiseTarget;
    // At 512 samples one step-1 a-trous pass is sufficient. A second, wider
    // pass visibly softened table and chair contact shadows.
    for (let pass = 0; pass < 1; pass += 1) {
      readTarget = readTarget === denoiseTarget ? workTarget : denoiseTarget;
      denoiseMaterial.uniforms.map!.value = denoiseSource;
      denoiseMaterial.uniforms.stepWidth!.value = 2 ** pass;
      renderer.setRenderTarget(readTarget);
      denoiseQuad.render(renderer);
      denoiseSource = readTarget.texture;
    }

    const dilationMaterial = createDilationMaterial();
    const dilationQuad = new FullScreenQuad(dilationMaterial);
    let writeTarget = readTarget === denoiseTarget ? workTarget : denoiseTarget;
    // Six two-texel dilations give the 1024px atlas a twelve-pixel gutter so
    // bilinear filtering cannot pull black or a neighboring chart into seams.
    for (let pass = 0; pass < 6; pass += 1) {
      dilationMaterial.uniforms.map!.value = readTarget.texture;
      renderer.setRenderTarget(writeTarget);
      dilationQuad.render(renderer);
      [readTarget, writeTarget] = [writeTarget, readTarget];
    }
    renderer.setRenderTarget(previousTarget);
    renderer.toneMapping = previousToneMapping;
    denoiseQuad.dispose();
    denoiseMaterial.dispose();
    fireflyQuad.dispose();
    fireflyMaterial.dispose();
    dilationQuad.dispose();
    dilationMaterial.dispose();
    writeTarget.dispose();

    retainedTarget = readTarget;
    appliedTexture = readTarget.texture;
    applyLightMap(unwrapped, appliedTexture, directionalTarget.texture);

    const pixels = new Float32Array(resolution * resolution * 4);
    const directionPixels = new Float32Array(resolution * resolution * 4);
    renderer.readRenderTargetPixels(
      readTarget,
      0,
      0,
      resolution,
      resolution,
      pixels,
    );
    renderer.readRenderTargetPixels(
      directionalTarget,
      0,
      0,
      resolution,
      resolution,
      directionPixels,
    );
    cacheLightMap(cacheKey, {
      data: pixels,
      directionData: directionPixels,
      height: resolution,
      width: resolution,
    });

    tracer.dispose();
    positionTarget.dispose();
    normalTarget.dispose();
    chartTarget.dispose();
    finished = true;
    onProgress?.(100);
    return appliedTexture;
  };

  return {
    cached: false,
    get samples() {
      return tracer.samples;
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      if (!finished) {
        tracer.dispose();
        positionTarget.dispose();
        normalTarget.dispose();
        chartTarget.dispose();
      }
      directionalTarget.dispose();
      retainedTarget?.dispose();
      for (const { originalGeometry } of unwrapped) originalGeometry.dispose();
    },
    finish,
    renderSample: () => {
      if (!finished && !disposed) tracer.renderSample();
    },
  };
}
