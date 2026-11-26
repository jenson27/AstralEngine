struct FrameUniforms {
    viewMatrix: mat4x4<f32>,
    projectionMatrix: mat4x4<f32>,
};

struct SpriteUniforms {
    positionWidth: vec4<f32>,
    rightHeight: vec4<f32>,
    upPivotX: vec4<f32>,
    uvRect: vec4<f32>,
    tint: vec4<f32>,
    pivotY: vec4<f32>,
};

@group(0) @binding(0) var<uniform> frame: FrameUniforms;
@group(1) @binding(0) var<uniform> sprite: SpriteUniforms;
@group(2) @binding(0) var spriteTexture: texture_2d<f32>;
@group(2) @binding(1) var spriteSampler: sampler;

struct VertexInput {
    @location(0) position: vec2<f32>,
    @location(1) uv: vec2<f32>,
};

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
    @location(1) tint: vec4<f32>,
};

@vertex
fn VertexMain(input: VertexInput) -> VertexOutput {
    let localPosition = vec2<f32>(
        (input.position.x - sprite.upPivotX.w) * sprite.positionWidth.w,
        (input.position.y - sprite.pivotY.x) * sprite.rightHeight.w,
    );
    let worldPosition = sprite.positionWidth.xyz +
        sprite.rightHeight.xyz * localPosition.x +
        sprite.upPivotX.xyz * localPosition.y;
    var output: VertexOutput;
    output.position = frame.projectionMatrix * frame.viewMatrix * vec4<f32>(worldPosition, 1.0);
    output.uv = sprite.uvRect.xy + input.uv * sprite.uvRect.zw;
    output.tint = sprite.tint;
    return output;
}

@fragment
fn FragmentMain(input: VertexOutput) -> @location(0) vec4<f32> {
    return textureSample(spriteTexture, spriteSampler, input.uv) * input.tint;
}
