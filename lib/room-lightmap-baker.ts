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
  return `room-lightmap-v12-${(hash >>> 0).toString(36)}`;
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
        attributeAsFloat32(position),
        meshInfo.positionOffset / Float32Array.BYTES_PER_ELEMENT,
      );
      atlas.HEAPF32.set(
        attributeAsFloat32(normal),
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
  material.fragmentShader = material.fragmentShader
    .replace(
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
       ray.origin = lightMapPositionSample.xyz + lightMapNormal * RAY_OFFSET * 4.0;
       ray.direction = normalize(
         lightMapTangent * cos(hemisphereAngle) * hemisphereRadius +
         lightMapBitangent * sin(hemisphereAngle) * hemisphereRadius +
         lightMapNormal * hemisphereCosine
       );
       float lightMapInitialPdf = hemisphereCosine * RECIPROCAL_PI;
       float lightMapContactOcclusion = 0.0;`,
    )
    .replace(
      "ScatterRecord scatterRec;",
      `ScatterRecord scatterRec;
       scatterRec.pdf = max(lightMapInitialPdf, 1e-6);
       scatterRec.specularPdf = 0.0;
       scatterRec.direction = ray.direction;
       scatterRec.color = vec3(1.0);`,
    )
    .replace(
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
               lightMapLightPdf *
               RECIPROCAL_PI;
           }
         }
       }
       state.isShadowRay = false;
       vec3 lightMapDirectRadiance = gl_FragColor.rgb;`,
    )
    .replace(
      "state.firstRay = i == 0 && state.transmissiveTraversals == transmissiveBounces;",
      "state.firstRay = false;",
    )
    .replace(
      "if ( ! state.firstRay && ! state.transmissiveRay ) {",
      "if ( i > 0 && ! state.transmissiveRay ) {",
    )
    .replace(
      "int hitType = traceScene( ray, state.fogMaterial, surfaceHit );",
      `int hitType = traceScene( ray, state.fogMaterial, surfaceHit );
       if (i == 0 && hitType == SURFACE_HIT) {
         // A cosine-weighted visibility sample supplies stable, view-independent
         // contact occlusion beneath nearby geometry. This remains separate
         // from the long window penumbra and fades out before it can become a
         // generic room-wide ambient shadow.
         float lightMapContactSurfaceWeight = smoothstep(
           0.55,
           0.82,
           lightMapNormal.y
         );
         lightMapContactOcclusion = lightMapContactSurfaceWeight *
           (1.0 - smoothstep(0.025, 0.45, surfaceHit.dist));
       }`,
    )
    .replace(
      "scatterRec = bsdfSample( - ray.direction, surf );",
      `// Lightmaps store diffuse irradiance. Sampling glossy, metallic, and
       // transmissive lobes here adds unstable caustic fireflies that do not
       // belong in a diffuse bake. A cosine-weighted Lambert bounce retains
       // material colour bleeding and physically meaningful multi-bounce GI.
       vec2 lightMapBounceSample = rand2(14);
       float lightMapBounceRadius = sqrt(lightMapBounceSample.x);
       float lightMapBounceAngle = 2.0 * PI * lightMapBounceSample.y;
       float lightMapBounceCosine = sqrt(
         max(0.0, 1.0 - lightMapBounceSample.x)
       );
       vec3 lightMapBounceNormal = surf.normal;
       vec3 lightMapBounceTangent = normalize(
         abs(lightMapBounceNormal.z) < 0.999
           ? cross(vec3(0.0, 0.0, 1.0), lightMapBounceNormal)
           : cross(vec3(0.0, 1.0, 0.0), lightMapBounceNormal)
       );
       vec3 lightMapBounceBitangent = cross(
         lightMapBounceNormal,
         lightMapBounceTangent
       );
       scatterRec.direction = normalize(
         lightMapBounceTangent * cos(lightMapBounceAngle) * lightMapBounceRadius +
         lightMapBounceBitangent * sin(lightMapBounceAngle) * lightMapBounceRadius +
         lightMapBounceNormal * lightMapBounceCosine
       );
       scatterRec.pdf = max(
         dot(lightMapBounceNormal, scatterRec.direction) * RECIPROCAL_PI,
         1e-6
       );
       scatterRec.specularPdf = 0.0;
       scatterRec.color = surf.color * scatterRec.pdf;`,
    )
    .replace(
      "gl_FragColor.a *= opacity;",
      `float lightMapContactVisibility =
         1.0 - lightMapContactOcclusion * 0.46;
       vec3 lightMapIndirectRadiance = max(
         gl_FragColor.rgb - lightMapDirectRadiance,
         vec3(0.0)
       );
       // Keep a single rare bounce from dominating one texel. Direct window
       // illumination is not clamped, so legitimate bright apertures and soft
       // shadow gradients retain their full energy.
       float lightMapIndirectPeak = max(
         lightMapIndirectRadiance.r,
         max(lightMapIndirectRadiance.g, lightMapIndirectRadiance.b)
       );
       lightMapIndirectRadiance *= min(
         1.0,
         4.0 / max(lightMapIndirectPeak, 1e-6)
       );
       // Compress the direct-to-bounce ratio before display tone mapping.
       // This preserves physical spatial variation while preventing a nearby
       // white wall from overpowering the useful multi-bounce fill deeper in
       // the room.
       vec3 lightMapBalancedRadiance =
         lightMapDirectRadiance * 0.82 +
         lightMapIndirectRadiance * 1.18;
       gl_FragColor.rgb = min(
         lightMapBalancedRadiance *
           PI * lightMapContactVisibility,
         vec3(20.0)
       );
       gl_FragColor.a = lightMapPositionSample.a * opacity;`,
    );
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
        for (int y = -2; y <= 2; y++) {
          for (int x = -2; x <= 2; x++) {
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
              luminanceScale * 1.75
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

function applyLightMap(receivers: UnwrappedReceiver[], texture: THREE.Texture) {
  texture.channel = 1;
  texture.flipY = false;
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
    material.lightMap = texture;
    // Leave headroom for the display transform so window penumbrae retain
    // visible tonal separation on bright materials.
    material.lightMapIntensity = 0.92;
    material.needsUpdate = true;
  }
}

function cachedTexture(entry: BakeCacheEntry) {
  const texture = new THREE.DataTexture(
    entry.data,
    entry.width,
    entry.height,
    THREE.RGBAFormat,
    THREE.FloatType,
  );
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.NoColorSpace;
  texture.needsUpdate = true;
  return texture;
}

export async function createRoomLightMapBake({
  cacheKey,
  onProgress,
  renderer,
  resolution = 1024,
  roots,
  scene,
}: {
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
    const texture = cachedTexture(cached);
    applyLightMap(unwrapped, texture);
    onProgress?.(100);
    return {
      cached: true,
      samples: Number.POSITIVE_INFINITY,
      dispose: () => {
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
  onProgress?.(12);

  const { WebGLPathTracer } = await import("three-gpu-pathtracer");
  const tracer = new WebGLPathTracer(renderer);
  tracer.bounces = 8;
  tracer.transmissiveBounces = 4;
  tracer.filterGlossyFactor = 1;
  tracer.multipleImportanceSampling = true;
  tracer.tiles.set(2, 2);
  tracer.renderDelay = 0;
  tracer.minSamples = 1;
  tracer.dynamicLowRes = false;
  tracer.rasterizeScene = false;
  tracer.renderToCanvas = false;
  tracer.synchronizeRenderSize = false;
  tracer.textureSize.set(1024, 1024);
  tracer.setScene(scene, new THREE.PerspectiveCamera(), {
    onProgress: (progress) => onProgress?.(12 + Math.round(progress * 8)),
  });
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
    // Two a-trous passes remove residual path-tracing noise while preserving
    // the higher-resolution furniture footprints and short contact shadows.
    // A third four-texel step visibly smeared chair and table detail.
    for (let pass = 0; pass < 2; pass += 1) {
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
    for (let pass = 0; pass < 4; pass += 1) {
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
    applyLightMap(unwrapped, appliedTexture);

    const pixels = new Float32Array(resolution * resolution * 4);
    renderer.readRenderTargetPixels(
      readTarget,
      0,
      0,
      resolution,
      resolution,
      pixels,
    );
    cacheLightMap(cacheKey, { data: pixels, height: resolution, width: resolution });

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
      retainedTarget?.dispose();
      for (const { originalGeometry } of unwrapped) originalGeometry.dispose();
    },
    finish,
    renderSample: () => {
      if (!finished && !disposed) tracer.renderSample();
    },
  };
}
