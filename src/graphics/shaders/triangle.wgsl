struct VertexOutput {
    @builtin(position) position: vec4f,
};

@vertex
fn VertexMain(
    @builtin(vertex_index) vertexIndex: u32,
) -> VertexOutput {
    let positions = array<vec2f, 3>(
        vec2f(0.0, 0.6),
        vec2f(-0.6, -0.5),
        vec2f(0.6, -0.5),
    );

    var output: VertexOutput;
    output.position = vec4f(positions[vertexIndex], 0.0, 1.0);
    return output;
}

@fragment
fn FragmentMain() -> @location(0) vec4f {
    return vec4f(0.95, 0.45, 0.15, 1.0);
}