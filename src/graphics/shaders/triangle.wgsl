struct TransformUniform {
    modelMatrix: mat4x4<f32>,
    viewMatrix: mat4x4<f32>,
    projectionMatrix: mat4x4<f32>,
};

@group(0) @binding(0)
var<uniform> transform: TransformUniform;

@group(1) @binding(0)
var baseColorTexture: texture_2d<f32>;

@group(1) @binding(1)
var baseColorSampler: sampler;

struct VertexInput {
    @location(0) position: vec3f,
    @location(1) uv: vec2f,
};

struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) uv: vec2f,
};

@vertex
fn VertexMain(input: VertexInput) -> VertexOutput {
    var output: VertexOutput;

    output.position =
        transform.projectionMatrix *
        transform.viewMatrix *
        transform.modelMatrix *
        vec4f(input.position, 1.0);

    output.uv = input.uv;
    return output;
}

@fragment
fn FragmentMain(input: VertexOutput) -> @location(0) vec4f {
    return textureSample(
        baseColorTexture,
        baseColorSampler,
        input.uv,
    );
}
