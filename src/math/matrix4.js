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
