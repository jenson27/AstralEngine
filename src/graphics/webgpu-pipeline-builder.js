export async function CreateWebGpuPipeline({
    device,
    format,
    depthFormat,
    matrixBlockSize,
    shaderCode,
    mipmapShaderCode,
}) {
    const shaderModule = device.createShaderModule({
        code: shaderCode,
    });

    const transformBindGroupLayout = device.createBindGroupLayout({
        entries: [
            {
                binding: 0,
                visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
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
            {
                binding: 2,
                visibility: GPUShaderStage.FRAGMENT,
                buffer: {
                    type: "uniform",
                    minBindingSize: 48,
                },
            },
            {
                binding: 3,
                visibility: GPUShaderStage.FRAGMENT,
                texture: {
                    sampleType: "float",
                    viewDimension: "2d",
                },
            },
            {
                binding: 4,
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
                    arrayStride: 56,
                    attributes: [
                        {
                            format: "float32x3",
                            offset: 0,
                            shaderLocation: 0,
                        },
                        {
                            format: "float32x3",
                            offset: 12,
                            shaderLocation: 1,
                        },
                        {
                            format: "float32x2",
                            offset: 24,
                            shaderLocation: 2,
                        },
                        {
                            format: "float32x2",
                            offset: 32,
                            shaderLocation: 3,
                        },
                        {
                            format: "float32x4",
                            offset: 40,
                            shaderLocation: 4,
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

    const mipmapShaderModule = device.createShaderModule({
        code: mipmapShaderCode,
    });
    const mipmapPipeline = await device.createRenderPipelineAsync({
        layout: "auto",
        vertex: {
            module: mipmapShaderModule,
            entryPoint: "VertexMain",
        },
        fragment: {
            module: mipmapShaderModule,
            entryPoint: "FragmentMain",
            targets: [{ format: "rgba8unorm-srgb" }],
        },
        primitive: {
            topology: "triangle-list",
        },
    });
    const linearMipmapPipeline = await device.createRenderPipelineAsync({
        layout: "auto",
        vertex: {
            module: mipmapShaderModule,
            entryPoint: "VertexMain",
        },
        fragment: {
            module: mipmapShaderModule,
            entryPoint: "FragmentMain",
            targets: [{ format: "rgba8unorm" }],
        },
        primitive: {
            topology: "triangle-list",
        },
    });

    return {
        pipeline,
        mipmapPipeline,
        linearMipmapPipeline,
        transformBindGroupLayout,
        materialBindGroupLayout,
    };
}
