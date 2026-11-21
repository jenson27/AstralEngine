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

export function SetQuaternionFromEuler(out, rotation) {
    const halfX = rotation[0] * 0.5;
    const halfY = rotation[1] * 0.5;
    const halfZ = rotation[2] * 0.5;

    const sineX = Math.sin(halfX);
    const cosineX = Math.cos(halfX);
    const sineY = Math.sin(halfY);
    const cosineY = Math.cos(halfY);
    const sineZ = Math.sin(halfZ);
    const cosineZ = Math.cos(halfZ);

    out[0] =
        sineX * cosineY * cosineZ -
        cosineX * sineY * sineZ;
    out[1] =
        cosineX * sineY * cosineZ +
        sineX * cosineY * sineZ;
    out[2] =
        cosineX * cosineY * sineZ -
        sineX * sineY * cosineZ;
    out[3] =
        cosineX * cosineY * cosineZ +
        sineX * sineY * sineZ;

    return out;
}

export function SlerpQuaternion(out, start, end, alpha) {
    if (!Number.isFinite(alpha) || alpha < 0 || alpha > 1) {
        throw new RangeError(
            "Quaternion interpolation alpha must be between 0 and 1.",
        );
    }

    let endX = end[0];
    let endY = end[1];
    let endZ = end[2];
    let endW = end[3];

    let dot =
        start[0] * endX +
        start[1] * endY +
        start[2] * endZ +
        start[3] * endW;

    if (dot < 0) {
        dot = -dot;
        endX = -endX;
        endY = -endY;
        endZ = -endZ;
        endW = -endW;
    }

    if (dot > 0.9995) {
        out[0] = start[0] + (endX - start[0]) * alpha;
        out[1] = start[1] + (endY - start[1]) * alpha;
        out[2] = start[2] + (endZ - start[2]) * alpha;
        out[3] = start[3] + (endW - start[3]) * alpha;

        const length = Math.hypot(out[0], out[1], out[2], out[3]);
        out[0] /= length;
        out[1] /= length;
        out[2] /= length;
        out[3] /= length;

        return out;
    }

    const angle = Math.acos(Math.min(1, dot));
    const sineAngle = Math.sin(angle);
    const startWeight = Math.sin((1 - alpha) * angle) / sineAngle;
    const endWeight = Math.sin(alpha * angle) / sineAngle;

    out[0] = start[0] * startWeight + endX * endWeight;
    out[1] = start[1] * startWeight + endY * endWeight;
    out[2] = start[2] * startWeight + endZ * endWeight;
    out[3] = start[3] * startWeight + endW * endWeight;

    return out;
}

export function SetTRSMatrixFromQuaternion(
    matrix,
    position,
    quaternion,
    scale,
) {
    const quaternionLength = Math.hypot(
        quaternion[0],
        quaternion[1],
        quaternion[2],
        quaternion[3],
    );

    if (!Number.isFinite(quaternionLength) || quaternionLength === 0) {
        throw new RangeError(
            "Rotation quaternion must be finite and non-zero.",
        );
    }

    const x = quaternion[0] / quaternionLength;
    const y = quaternion[1] / quaternionLength;
    const z = quaternion[2] / quaternionLength;
    const w = quaternion[3] / quaternionLength;

    const r00 = 1 - 2 * (y * y + z * z);
    const r01 = 2 * (x * y - z * w);
    const r02 = 2 * (x * z + y * w);

    const r10 = 2 * (x * y + z * w);
    const r11 = 1 - 2 * (x * x + z * z);
    const r12 = 2 * (y * z - x * w);

    const r20 = 2 * (x * z - y * w);
    const r21 = 2 * (y * z + x * w);
    const r22 = 1 - 2 * (x * x + y * y);

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

export function SetOrthographicMatrix(
    matrix,
    verticalSize,
    aspectRatio,
    nearPlane,
    farPlane,
) {
    if (
        !Number.isFinite(verticalSize) ||
        !Number.isFinite(aspectRatio) ||
        !Number.isFinite(nearPlane) ||
        !Number.isFinite(farPlane) ||
        verticalSize <= 0 ||
        aspectRatio <= 0 ||
        nearPlane <= 0 ||
        farPlane <= nearPlane
    ) {
        throw new RangeError("Orthographic matrix parameters are invalid.");
    }

    matrix.fill(0);
    matrix[0] = 1 / (verticalSize * aspectRatio);
    matrix[5] = 1 / verticalSize;
    matrix[10] = 1 / (nearPlane - farPlane);
    matrix[14] = nearPlane / (nearPlane - farPlane);
    matrix[15] = 1;

    return matrix;
}

export function MultiplyMatrix4(out, left, right) {
    if (out === left || out === right) {
        throw new TypeError(
            "Output matrix must not alias either input matrix.",
        );
    }

    for (let column = 0; column < 4; column += 1) {
        for (let row = 0; row < 4; row += 1) {
            const index = column * 4 + row;

            out[index] =
                left[row] * right[column * 4] +
                left[4 + row] * right[column * 4 + 1] +
                left[8 + row] * right[column * 4 + 2] +
                left[12 + row] * right[column * 4 + 3];
        }
    }

    return out;
}

export function SetViewMatrixFromWorldMatrix(viewMatrix, worldMatrix) {
    if (viewMatrix === worldMatrix) {
        throw new TypeError(
            "View matrix must not alias the camera world matrix.",
        );
    }

    const m00 = worldMatrix[0];
    const m01 = worldMatrix[4];
    const m02 = worldMatrix[8];
    const m10 = worldMatrix[1];
    const m11 = worldMatrix[5];
    const m12 = worldMatrix[9];
    const m20 = worldMatrix[2];
    const m21 = worldMatrix[6];
    const m22 = worldMatrix[10];

    const determinant =
        m00 * (m11 * m22 - m12 * m21) -
        m01 * (m10 * m22 - m12 * m20) +
        m02 * (m10 * m21 - m11 * m20);

    if (!Number.isFinite(determinant) || determinant === 0) {
        throw new RangeError(
            "Camera world matrix must be invertible.",
        );
    }

    const inverseDeterminant = 1 / determinant;
    const inverse00 =
        (m11 * m22 - m12 * m21) * inverseDeterminant;
    const inverse01 =
        (m02 * m21 - m01 * m22) * inverseDeterminant;
    const inverse02 =
        (m01 * m12 - m02 * m11) * inverseDeterminant;
    const inverse10 =
        (m12 * m20 - m10 * m22) * inverseDeterminant;
    const inverse11 =
        (m00 * m22 - m02 * m20) * inverseDeterminant;
    const inverse12 =
        (m02 * m10 - m00 * m12) * inverseDeterminant;
    const inverse20 =
        (m10 * m21 - m11 * m20) * inverseDeterminant;
    const inverse21 =
        (m01 * m20 - m00 * m21) * inverseDeterminant;
    const inverse22 =
        (m00 * m11 - m01 * m10) * inverseDeterminant;

    viewMatrix[0] = inverse00;
    viewMatrix[1] = inverse10;
    viewMatrix[2] = inverse20;
    viewMatrix[3] = 0;
    viewMatrix[4] = inverse01;
    viewMatrix[5] = inverse11;
    viewMatrix[6] = inverse21;
    viewMatrix[7] = 0;
    viewMatrix[8] = inverse02;
    viewMatrix[9] = inverse12;
    viewMatrix[10] = inverse22;
    viewMatrix[11] = 0;

    const positionX = worldMatrix[12];
    const positionY = worldMatrix[13];
    const positionZ = worldMatrix[14];

    viewMatrix[12] =
        -(inverse00 * positionX +
            inverse01 * positionY +
            inverse02 * positionZ);
    viewMatrix[13] =
        -(inverse10 * positionX +
            inverse11 * positionY +
            inverse12 * positionZ);
    viewMatrix[14] =
        -(inverse20 * positionX +
            inverse21 * positionY +
            inverse22 * positionZ);
    viewMatrix[15] = 1;

    return viewMatrix;
}
