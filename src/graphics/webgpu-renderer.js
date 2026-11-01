// WebGPURenderer is a class that encapsulates the functionality of rendering graphics using the WebGPU API.
// It initializes GPU resources, including a vertex buffer, and draws a mesh to the canvas.

import { AstralLogger } from "../diagnostics/logger.js";
import { AssetHandle } from "../core/assets/asset-handle.js";
import { Mesh } from "./mesh.js";
import { Material } from "./material.js";

const shaderUrl = new URL("./shaders/triangle.wgsl", import.meta.url);

export class WebGPURenderer {
    constructor(canvas) {
        this._canvas = canvas;
        this._context = null;
        this._device = null;
        this._format = null;
        this._pipeline = null;
        this._meshResources = new Map();
        this._textureResources = new Map();
        this._materialBindGroups = new Map();
        this._drawItems = [];
        this._transformBindGroupLayout = null;
        this._materialBindGroupLayout = null;
        this._textureSampler = null;
        this._transformBuffer = null;
        this._transformBindGroup = null;
        this._matrixBlockSize = 16 * 3 * Float32Array.BYTES_PER_ELEMENT;
        this._uniformStride = 0;
        this._drawCapacity = 0;
        this._matrixData = new Float32Array(0);
        this._depthTexture = null;
        this._depthView = null;
        this._depthWidth = 0;
        this._depthHeight = 0;
        this._depthFormat = "depth24plus";
        this._deviceLostInfo = null;
    }

    // Initialize the WebGPU renderer by requesting a GPU adapter and device, and configuring the canvas context.
    async Initialize() {
        await this._InitializeDevice();
        this._ConfigureCanvasContext();

        const shaderCode = await this._LoadShader();

        this._pipeline = await this._CreatePipeline(shaderCode);
        this._textureSampler = this._device.createSampler({
            addressModeU: "repeat",
            addressModeV: "repeat",
            magFilter: "linear",
            minFilter: "linear",
        });
        this._InitializeTransformResources();
    }

    async _InitializeDevice() {
        if (!navigator.gpu) {
            throw new Error("WebGPU is not available in this browser.");
        }

        const adapter = await navigator.gpu.requestAdapter();

        if (!adapter) {
            throw new Error("The browser could not access a GPU adapter.");
        }

        this._device = await adapter.requestDevice();
        this._deviceLostInfo = null;

        const device = this._device;

        device.lost.then((lostInfo) => {
            if (lostInfo.reason === "destroyed") {
                return;
            }

            this._deviceLostInfo = lostInfo;
            AstralLogger.Error("WebGPU device lost.", {
                reason: lostInfo.reason,
                message: lostInfo.message,
            });
        });

        device.addEventListener("uncapturederror", (event) => {
            AstralLogger.Error("Uncaptured WebGPU error.", {
                name: event.error.constructor.name,
                message: event.error.message,
            });
        });
    }

    _ConfigureCanvasContext() {
        this._context = this._canvas.getContext("webgpu");

        if (!this._context) {
            throw new Error("Could not create a WebGPU canvas context.");
        }

        this._format = navigator.gpu.getPreferredCanvasFormat();

        this._context.configure({
            device: this._device,
            format: this._format,
            alphaMode: "opaque",
        });

        this.EnsureDepthTexture();
    }

    async _LoadShader() {
        const shaderResponse = await fetch(shaderUrl);

        if (!shaderResponse.ok) {
            throw new Error(
                `Could not load triangle shader. HTTP ${shaderResponse.status}.`,
            );
        }

        return shaderResponse.text();
    }

    async _CreatePipeline(shaderCode) {
        const shaderModule = this._device.createShaderModule({
            code: shaderCode,
        });

        this._transformBindGroupLayout =
            this._device.createBindGroupLayout({
                entries: [
                    {
                        binding: 0,
                        visibility: GPUShaderStage.VERTEX,
                        buffer: {
                            type: "uniform",
                            hasDynamicOffset: true,
                            minBindingSize: this._matrixBlockSize,
                        },
                    },
                ],
            });

        this._materialBindGroupLayout =
            this._device.createBindGroupLayout({
                entries: [
                    {
                        binding: 0,
                        visibility: GPUShaderStage.FRAGMENT,
                        texture: {
                            sampleType: "float",
                            viewDimension: "2d",
                        },
                    },
                    {
                        binding: 1,
                        visibility: GPUShaderStage.FRAGMENT,
                        sampler: {
                            type: "filtering",
                        },
                    },
                ],
            });

        const pipelineLayout = this._device.createPipelineLayout({
            bindGroupLayouts: [
                this._transformBindGroupLayout,
                this._materialBindGroupLayout,
            ],
        });

        return this._device.createRenderPipelineAsync({
            layout: pipelineLayout,
            vertex: {
                module: shaderModule,
                entryPoint: "VertexMain",
                buffers: [
                    {
                        arrayStride: 20,
                        attributes: [
                            {
                                format: "float32x3",
                                offset: 0,
                                shaderLocation: 0,
                            },
                            {
                                format: "float32x2",
                                offset: 12,
                                shaderLocation: 1,
                            },
                        ],
                    },
                ],
            },
            fragment: {
                module: shaderModule,
                entryPoint: "FragmentMain",
                targets: [{ format: this._format }],
            },
            primitive: {
                topology: "triangle-list",
            },
            depthStencil: {
                format: this._depthFormat,
                depthWriteEnabled: true,
                depthCompare: "less",
            },
        });
    }

    _InitializeTransformResources() {
        const alignment =
            this._device.limits.minUniformBufferOffsetAlignment;
        this._uniformStride =
            Math.ceil(this._matrixBlockSize / alignment) * alignment;
        this._EnsureTransformCapacity(1);
    }

    SetRenderItems(renderItems, viewMatrix, projectionMatrix) {
        if (!Array.isArray(renderItems)) {
            throw new TypeError("Render items must be an array.");
        }

        if (!this._device || !this._transformBuffer) {
            throw new Error("Renderer is not initialized.");
        }

        this._RequireMatrix(viewMatrix, "View matrix");
        this._RequireMatrix(projectionMatrix, "Projection matrix");
        this._EnsureTransformCapacity(renderItems.length);
        this._drawItems.length = 0;
        const activeMeshes = new Set();
        const activeMaterials = new Set();

        const floatsPerDraw =
            this._uniformStride / Float32Array.BYTES_PER_ELEMENT;

        for (let index = 0; index < renderItems.length; index += 1) {
            const renderItem = renderItems[index];

            if (!renderItem || typeof renderItem !== "object") {
                throw new TypeError("Each render item must be an object.");
            }

            this._RequireMatrix(renderItem.modelMatrix, "Model matrix");

            if (!(renderItem.meshHandle instanceof AssetHandle)) {
                throw new TypeError(
                    "Render item requires a mesh asset handle.",
                );
            }

            const mesh = renderItem.meshHandle.Current;
            activeMeshes.add(mesh);
            const meshResource = this._GetMeshResource(mesh);
            const transformOffset = index * this._uniformStride;

            for (const submesh of meshResource.submeshes) {
                const materialHandle =
                    renderItem.materialHandlesBySlot?.[
                        submesh.materialSlot
                    ];

                if (!(materialHandle instanceof AssetHandle)) {
                    throw new TypeError(
                        `Render item has no material handle for slot "${submesh.materialSlot}".`,
                    );
                }

                const material = materialHandle.Current;

                if (!(material instanceof Material)) {
                    throw new TypeError(
                        `Material handle for slot "${submesh.materialSlot}" must contain a Material.`,
                    );
                }

                activeMaterials.add(material);
                this._drawItems.push({
                    vertexBuffer: meshResource.vertexBuffer,
                    firstVertex: submesh.firstVertex,
                    vertexCount: submesh.vertexCount,
                    transformOffset,
                    materialBindGroup:
                        this._GetMaterialBindGroup(material),
                });
            }

            const matrixOffset = index * floatsPerDraw;
            this._matrixData.set(renderItem.modelMatrix, matrixOffset);
            this._matrixData.set(viewMatrix, matrixOffset + 16);
            this._matrixData.set(projectionMatrix, matrixOffset + 32);
        }

        if (renderItems.length > 0) {
            const usedFloatCount = floatsPerDraw * renderItems.length;
            this._device.queue.writeBuffer(
                this._transformBuffer,
                0,
                this._matrixData.subarray(0, usedFloatCount),
            );
        }

        this._PruneMeshResources(activeMeshes);
        this._PruneMaterialResources(activeMaterials);
    }

    _RequireMatrix(matrix, name) {
        if (!(matrix instanceof Float32Array) || matrix.length !== 16) {
            throw new TypeError(`${name} must contain 16 values.`);
        }
    }

    _GetMeshResource(mesh) {
        if (!(mesh instanceof Mesh)) {
            throw new TypeError("Render item requires a Mesh.");
        }

        let meshResource = this._meshResources.get(mesh);

        if (meshResource) {
            return meshResource;
        }

        const positions = mesh.GetPositions();
        const uvs = mesh.GetUVs();
        const vertexData = new Float32Array(mesh.VertexCount * 5);

        for (let index = 0; index < mesh.VertexCount; index += 1) {
            vertexData.set(
                positions.subarray(index * 3, index * 3 + 3),
                index * 5,
            );
            vertexData.set(
                uvs.subarray(index * 2, index * 2 + 2),
                index * 5 + 3,
            );
        }

        const vertexBuffer = this._device.createBuffer({
            size: vertexData.byteLength,
            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
        });

        this._device.queue.writeBuffer(vertexBuffer, 0, vertexData);

        meshResource = {
            vertexBuffer,
            vertexCount: mesh.VertexCount,
            submeshes: mesh.Submeshes,
        };
        this._meshResources.set(mesh, meshResource);
        return meshResource;
    }

    _GetTextureResource(imageAsset) {
        let textureResource = this._textureResources.get(imageAsset);

        if (textureResource) {
            return textureResource;
        }

        if (
            !imageAsset?.bitmap ||
            !Number.isSafeInteger(imageAsset.width) ||
            imageAsset.width <= 0 ||
            !Number.isSafeInteger(imageAsset.height) ||
            imageAsset.height <= 0
        ) {
            throw new TypeError("Material has an invalid image asset.");
        }

        const texture = this._device.createTexture({
            size: [imageAsset.width, imageAsset.height, 1],
            format: "rgba8unorm-srgb",
            usage:
                GPUTextureUsage.TEXTURE_BINDING |
                GPUTextureUsage.COPY_DST |
                GPUTextureUsage.RENDER_ATTACHMENT,
        });

        try {
            this._device.queue.copyExternalImageToTexture(
                { source: imageAsset.bitmap },
                { texture },
                [imageAsset.width, imageAsset.height, 1],
            );
        } catch (error) {
            texture.destroy();
            throw error;
        }

        textureResource = {
            texture,
            view: texture.createView(),
        };
        this._textureResources.set(imageAsset, textureResource);

        return textureResource;
    }

    _GetMaterialBindGroup(material) {
        let bindGroup = this._materialBindGroups.get(material);

        if (bindGroup) {
            return bindGroup;
        }

        const textureResource = this._GetTextureResource(
            material.BaseColorTexture,
        );

        bindGroup = this._device.createBindGroup({
            layout: this._materialBindGroupLayout,
            entries: [
                {
                    binding: 0,
                    resource: textureResource.view,
                },
                {
                    binding: 1,
                    resource: this._textureSampler,
                },
            ],
        });

        this._materialBindGroups.set(material, bindGroup);
        return bindGroup;
    }

    _PruneMeshResources(activeMeshes) {
        for (const [mesh, meshResource] of this._meshResources) {
            if (!activeMeshes.has(mesh)) {
                meshResource.vertexBuffer.destroy();
                this._meshResources.delete(mesh);
            }
        }
    }

    _PruneMaterialResources(activeMaterials) {
        const activeTextures = new Set();

        for (const material of activeMaterials) {
            activeTextures.add(material.BaseColorTexture);
        }

        for (const material of this._materialBindGroups.keys()) {
            if (!activeMaterials.has(material)) {
                this._materialBindGroups.delete(material);
            }
        }

        for (const [imageAsset, textureResource] of this._textureResources) {
            if (!activeTextures.has(imageAsset)) {
                textureResource.texture.destroy();
                this._textureResources.delete(imageAsset);
            }
        }
    }

    _EnsureTransformCapacity(requiredDrawCount) {
        if (requiredDrawCount <= this._drawCapacity) {
            return;
        }

        let drawCapacity = Math.max(1, this._drawCapacity);
        while (drawCapacity < requiredDrawCount) {
            drawCapacity *= 2;
        }

        this._transformBuffer?.destroy();
        this._drawCapacity = drawCapacity;
        this._matrixData = new Float32Array(
            (this._uniformStride / Float32Array.BYTES_PER_ELEMENT) *
                drawCapacity,
        );

        this._transformBuffer = this._device.createBuffer({
            size: this._uniformStride * drawCapacity,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });

        this._transformBindGroup = this._device.createBindGroup({
            layout: this._transformBindGroupLayout,
            entries: [
                {
                    binding: 0,
                    resource: {
                        buffer: this._transformBuffer,
                        offset: 0,
                        size: this._matrixBlockSize,
                    },
                },
            ],
        });
    }

    EnsureDepthTexture() {
        const width = this._canvas.width;
        const height = this._canvas.height;

        if (
            this._depthTexture &&
            this._depthWidth === width &&
            this._depthHeight === height
        ) {
            return;
        }

        this._depthTexture?.destroy();

        this._depthTexture = this._device.createTexture({
            size: [width, height, 1],
            format: this._depthFormat,
            usage: GPUTextureUsage.RENDER_ATTACHMENT,
        });

        this._depthView = this._depthTexture.createView();
        this._depthWidth = width;
        this._depthHeight = height;
    }

    // Binds each mesh and its matrix data, then submits the frame to the GPU queue.
    Render() {
        if (this._deviceLostInfo) {
            throw new Error(
                `Cannot render because the WebGPU device was lost: ${this._deviceLostInfo.message}`,
            );
        }

        this.EnsureDepthTexture();

        const commandEncoder = this._device.createCommandEncoder();
        const canvasTexture = this._context.getCurrentTexture();

        const renderPass = commandEncoder.beginRenderPass({
            colorAttachments: [
                {
                    view: canvasTexture.createView(),
                    clearValue: { r: 0.04, g: 0.06, b: 0.1, a: 1 },
                    loadOp: "clear",
                    storeOp: "store",
                },
            ],
            depthStencilAttachment: {
                view: this._depthView,
                depthClearValue: 1,
                depthLoadOp: "clear",
                depthStoreOp: "store",
            },
        });

        renderPass.setPipeline(this._pipeline);

        for (const drawItem of this._drawItems) {
            renderPass.setBindGroup(0, this._transformBindGroup, [
                drawItem.transformOffset,
            ]);
            renderPass.setBindGroup(1, drawItem.materialBindGroup);
            renderPass.setVertexBuffer(0, drawItem.vertexBuffer);
            renderPass.draw(
                drawItem.vertexCount,
                1,
                drawItem.firstVertex,
            );
        }

        renderPass.end();

        this._device.queue.submit([commandEncoder.finish()]);
    }

    Shutdown() {
        this._context?.unconfigure();

        for (const meshResource of this._meshResources.values()) {
            meshResource.vertexBuffer.destroy();
        }

        for (const textureResource of this._textureResources.values()) {
            textureResource.texture.destroy();
        }

        this._meshResources.clear();
        this._textureResources.clear();
        this._materialBindGroups.clear();
        this._drawItems.length = 0;
        this._transformBuffer?.destroy();
        this._depthTexture?.destroy();
        this._device?.destroy();

        this._context = null;
        this._device = null;
        this._format = null;
        this._pipeline = null;
        this._transformBindGroupLayout = null;
        this._materialBindGroupLayout = null;
        this._textureSampler = null;
        this._transformBuffer = null;
        this._transformBindGroup = null;
        this._uniformStride = 0;
        this._drawCapacity = 0;
        this._matrixData = new Float32Array(0);
        this._depthTexture = null;
        this._depthView = null;
        this._depthWidth = 0;
        this._depthHeight = 0;
        this._deviceLostInfo = null;
    }
}
