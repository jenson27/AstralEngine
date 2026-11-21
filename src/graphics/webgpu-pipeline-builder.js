export async function CreateWebGpuPipeline({
    device,
    format,
    depthFormat,
    matrixBlockSize,
    shaderCode,
}) {
    const shaderModule = device.createShaderModule({
        code: shaderCode,
    });

    const transformBindGroupLayout = device.createBindGroupLayout({
        entries: [
            {
                binding: 0,
                visibility: GPUShaderStage.VERTEX,
                buffer: {
                    type: "uniform",
                    hasDynamicOffset: true,
                    minBindingSize: matrixBlockSize,
                },
            },
        ],
    });

    const materialBindGroupLayout = device.createBindGroupLayout({
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

    const pipelineLayout = device.createPipelineLayout({
        bindGroupLayouts: [
            transformBindGroupLayout,
            materialBindGroupLayout,
        ],
    });

    const pipeline = await device.createRenderPipelineAsync({
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
            targets: [{ format }],
        },
        primitive: {
            topology: "triangle-list",
        },
        depthStencil: {
            format: depthFormat,
            depthWriteEnabled: true,
            depthCompare: "less",
        },
    });

    return {
        pipeline,
        transformBindGroupLayout,
        materialBindGroupLayout,
    };
}
