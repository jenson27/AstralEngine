struct TransformUniform {
    modelMatrix: mat4x4<f32>,
};

@group(0) @binding(0)
var<uniform> transform: TransformUniform;

struct VertexInput {
    @location(0) position: vec2f,
};

struct VertexOutput {
    @builtin(position) position: vec4f,
};

@vertex
fn VertexMain(input: VertexInput) -> VertexOutput {
    var output: VertexOutput;
    output.position =
        transform.modelMatrix * vec4f(input.position, 0.0, 1.0);
    return output;
}

@fragment
fn FragmentMain() -> @location(0) vec4f {
    return vec4f(0.95, 0.45, 0.15, 1.0);
}
