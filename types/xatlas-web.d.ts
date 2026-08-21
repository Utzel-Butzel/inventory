declare module "xatlas-web" {
  type XAtlasMeshInfo = {
    indexOffset: number;
    meshId: number;
    normalOffset: number;
    positionOffset: number;
    uvOffset: number;
  };

  type XAtlasMeshData = {
    indexOffset: number;
    newIndexCount: number;
    newVertexCount: number;
    originalIndexOffset: number;
    uvOffset: number;
  };

  type XAtlasModule = {
    ready: Promise<XAtlasModule>;
    HEAPF32: Float32Array;
    HEAPU16: Uint16Array;
    HEAPU32: Uint32Array;
    createAtlas: () => void;
    createMesh: (
      vertexCount: number,
      indexCount: number,
      hasNormals: boolean,
      hasUvs: boolean,
    ) => XAtlasMeshInfo;
    addMesh: () => number;
    generateAtlas: () => void;
    getMeshData: (meshId: number) => XAtlasMeshData;
    destroyAtlas: () => void;
  };

  type XAtlasOptions = {
    locateFile?: (path: string) => string;
  };

  const createXAtlas: (options?: XAtlasOptions) => XAtlasModule;
  export default createXAtlas;
}
