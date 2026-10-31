export function SetTRSMatrix(matrix, position, rotation, scale) {
    const rotationX = rotation[0];
    const rotationY = rotation[1];
    const rotationZ = rotation[2];

    const cosineX = Math.cos(rotationX);
    const sineX = Math.sin(rotationX);
    const cosineY = Math.cos(rotationY);
    const sineY = Math.sin(rotationY);
    const cosineZ = Math.cos(rotationZ);
    const sineZ = Math.sin(rotationZ);

    // Build a rotation matrix with the order Z * Y * X.
    const r00 = cosineZ * cosineY;
    const r01 = cosineZ * sineY * sineX - sineZ * cosineX;
    const r02 = cosineZ * sineY * cosineX + sineZ * sineX;

    const r10 = sineZ * cosineY;
    const r11 = sineZ * sineY * sineX + cosineZ * cosineX;
    const r12 = sineZ * sineY * cosineX - cosineZ * sineX;

    const r20 = -sineY;
    const r21 = cosineY * sineX;
    const r22 = cosineY * cosineX;

    // Store the result in column-major order for WGSL.
    matrix[0] = r00 * scale[0];
    matrix[1] = r10 * scale[0];
    matrix[2] = r20 * scale[0];
    matrix[3] = 0;

    matrix[4] = r01 * scale[1];
    matrix[5] = r11 * scale[1];
    matrix[6] = r21 * scale[1];
    matrix[7] = 0;

    matrix[8] = r02 * scale[2];
    matrix[9] = r12 * scale[2];
    matrix[10] = r22 * scale[2];
    matrix[11] = 0;

    matrix[12] = position[0];
    matrix[13] = position[1];
    matrix[14] = position[2];
    matrix[15] = 1;

    return matrix;
}

export function SetViewMatrixFromTransform(matrix, position, rotation) {
    const rotationX = rotation[0];
    const rotationY = rotation[1];
    const rotationZ = rotation[2];

    const cosineX = Math.cos(rotationX);
    const sineX = Math.sin(rotationX);
    const cosineY = Math.cos(rotationY);
    const sineY = Math.sin(rotationY);
    const cosineZ = Math.cos(rotationZ);
    const sineZ = Math.sin(rotationZ);

    const r00 = cosineZ * cosineY;
    const r01 = cosineZ * sineY * sineX - sineZ * cosineX;
    const r02 = cosineZ * sineY * cosineX + sineZ * sineX;

    const r10 = sineZ * cosineY;
    const r11 = sineZ * sineY * sineX + cosineZ * cosineX;
    const r12 = sineZ * sineY * cosineX - cosineZ * sineX;

    const r20 = -sineY;
    const r21 = cosineY * sineX;
    const r22 = cosineY * cosineX;

    // The view matrix uses the inverse of the camera rotation.
    matrix[0] = r00;
    matrix[1] = r01;
    matrix[2] = r02;
    matrix[3] = 0;

    matrix[4] = r10;
    matrix[5] = r11;
    matrix[6] = r12;
    matrix[7] = 0;

    matrix[8] = r20;
    matrix[9] = r21;
    matrix[10] = r22;
    matrix[11] = 0;

    matrix[12] = -(r00 * position[0] + r10 * position[1] + r20 * position[2]);
    matrix[13] = -(r01 * position[0] + r11 * position[1] + r21 * position[2]);
    matrix[14] = -(r02 * position[0] + r12 * position[1] + r22 * position[2]);
    matrix[15] = 1;

    return matrix;
}

export function SetPerspectiveMatrix(
    matrix,
    fieldOfView,
    aspectRatio,
    nearPlane,
    farPlane,
) {
    if (
        !Number.isFinite(fieldOfView) ||
        !Number.isFinite(aspectRatio) ||
        !Number.isFinite(nearPlane) ||
        !Number.isFinite(farPlane) ||
        fieldOfView <= 0 ||
        fieldOfView >= Math.PI ||
        aspectRatio <= 0 ||
        nearPlane <= 0 ||
        farPlane <= nearPlane
    ) {
        throw new RangeError("Perspective matrix parameters are invalid.");
    }

    const scale = 1 / Math.tan(fieldOfView / 2);
    const depthRange = nearPlane - farPlane;

    matrix.fill(0);
    matrix[0] = scale / aspectRatio;
    matrix[5] = scale;
    matrix[10] = farPlane / depthRange;
    matrix[11] = -1;
    matrix[14] = (farPlane * nearPlane) / depthRange;

    return matrix;
}
