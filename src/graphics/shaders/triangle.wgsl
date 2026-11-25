const PI: f32 = 3.14159265359;

struct FrameUniform {
    viewMatrix: mat4x4<f32>,
    projectionMatrix: mat4x4<f32>,
    lightDirection: vec4f,
    lightColorIntensity: vec4f,
    cameraPosition: vec4f,
};

@group(0) @binding(0)
var<uniform> frame: FrameUniform;

struct TransformUniform {
    modelMatrix: mat4x4<f32>,
    normalMatrix: mat4x4<f32>,
};

@group(1) @binding(0)
var<uniform> transform: TransformUniform;

struct MaterialUniform {
    baseColorFactor: vec4f,
    pbrAlpha: vec4f,
    textureInfo: vec4f,
};

@group(2) @binding(0)
var baseColorTexture: texture_2d<f32>;

@group(2) @binding(1)
var baseColorSampler: sampler;

@group(2) @binding(2)
var<uniform> material: MaterialUniform;

@group(2) @binding(3)
var metallicRoughnessTexture: texture_2d<f32>;

@group(2) @binding(4)
var metallicRoughnessSampler: sampler;

struct VertexInput {
    @location(0) position: vec3f,
    @location(1) normal: vec3f,
    @location(2) uv0: vec2f,
    @location(3) uv1: vec2f,
    @location(4) color: vec4f,
};

struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) worldPosition: vec3f,
    @location(1) normal: vec3f,
    @location(2) uv0: vec2f,
    @location(3) uv1: vec2f,
    @location(4) color: vec4f,
};

@vertex
fn VertexMain(input: VertexInput) -> VertexOutput {
    var output: VertexOutput;
    let worldPosition = transform.modelMatrix * vec4f(input.position, 1.0);
    output.position = frame.projectionMatrix * frame.viewMatrix * worldPosition;
    output.worldPosition = worldPosition.xyz;
    output.normal = normalize((transform.normalMatrix * vec4f(input.normal, 0.0)).xyz);
    output.uv0 = input.uv0;
    output.uv1 = input.uv1;
    output.color = input.color;
    return output;
}

fn DistributionGGX(nDotH: f32, roughness: f32) -> f32 {
    let alpha = roughness * roughness;
    let alphaSquared = alpha * alpha;
    let denominator = nDotH * nDotH * (alphaSquared - 1.0) + 1.0;
    return alphaSquared / max(PI * denominator * denominator, 0.000001);
}

fn GeometrySchlickGGX(nDotDirection: f32, roughness: f32) -> f32 {
    let k = (roughness + 1.0) * (roughness + 1.0) / 8.0;
    return nDotDirection / max(nDotDirection * (1.0 - k) + k, 0.000001);
}

fn FresnelSchlick(cosine: f32, f0: vec3f) -> vec3f {
    return f0 + (vec3f(1.0) - f0) * pow(1.0 - cosine, 5.0);
}

fn ToneMapAces(color: vec3f) -> vec3f {
    let a = 2.51;
    let b = 0.03;
    let c = 2.43;
    let d = 0.59;
    let e = 0.14;
    return clamp(
        (color * (a * color + b)) /
            (color * (c * color + d) + e),
        vec3f(0.0),
        vec3f(1.0),
    );
}

fn LinearToSrgb(color: vec3f) -> vec3f {
    let bounded = clamp(color, vec3f(0.0), vec3f(1.0));
    let low = bounded * 12.92;
    let high = 1.055 * pow(bounded, vec3f(1.0 / 2.4)) - 0.055;
    return select(high, low, bounded <= vec3f(0.0031308));
}

@fragment
fn FragmentMain(input: VertexOutput) -> @location(0) vec4f {
    let baseUv = select(input.uv0, input.uv1, material.textureInfo.x > 0.5);
    let metallicRoughnessUv = select(input.uv0, input.uv1, material.textureInfo.y > 0.5);
    let baseColor = textureSample(baseColorTexture, baseColorSampler, baseUv) *
        material.baseColorFactor * input.color;
    if (material.pbrAlpha.w > 0.5 && baseColor.a < material.pbrAlpha.z) {
        discard;
    }
    if (material.textureInfo.z > 0.5) {
        return vec4f(LinearToSrgb(baseColor.rgb), 1.0);
    }

    let metallicRoughness = textureSample(
        metallicRoughnessTexture,
        metallicRoughnessSampler,
        metallicRoughnessUv,
    );
    let metallic = clamp(material.pbrAlpha.x * metallicRoughness.b, 0.0, 1.0);
    let roughness = clamp(material.pbrAlpha.y * metallicRoughness.g, 0.04, 1.0);
    let normal = normalize(input.normal);
    let viewDirection = normalize(frame.cameraPosition.xyz - input.worldPosition);
    let lightDirection = normalize(frame.lightDirection.xyz);
    let halfwayDirection = normalize(viewDirection + lightDirection);
    let nDotL = max(dot(normal, lightDirection), 0.0);
    let nDotV = max(dot(normal, viewDirection), 0.0001);
    let nDotH = max(dot(normal, halfwayDirection), 0.0);
    let hDotV = max(dot(halfwayDirection, viewDirection), 0.0);

    let f0 = mix(vec3f(0.04), baseColor.rgb, metallic);
    let fresnel = FresnelSchlick(hDotV, f0);
    let distribution = DistributionGGX(nDotH, roughness);
    let geometry = GeometrySchlickGGX(nDotV, roughness) *
        GeometrySchlickGGX(nDotL, roughness);
    let specular = distribution * geometry * fresnel /
        max(4.0 * nDotV * max(nDotL, 0.0001), 0.0001);
    let diffuseWeight = (vec3f(1.0) - fresnel) * (1.0 - metallic);
    let diffuse = diffuseWeight * baseColor.rgb / PI;
    let radiance = frame.lightColorIntensity.rgb *
        frame.lightColorIntensity.a;
    let litColor = (diffuse + specular) * radiance * nDotL;
    return vec4f(LinearToSrgb(ToneMapAces(litColor)), 1.0);
}
