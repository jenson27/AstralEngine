export function RadiansToDegrees(radians) {
    return (radians * 180) / Math.PI;
}

export function DegreesToRadians(degrees) {
    return (degrees * Math.PI) / 180;
}

export function AreDataValuesEqual(left, right) {
    if (Object.is(left, right)) {
        return true;
    }
    if (Array.isArray(left) && Array.isArray(right)) {
        return (
            left.length === right.length &&
            left.every((value, index) => AreDataValuesEqual(value, right[index]))
        );
    }
    if (
        left === null ||
        right === null ||
        typeof left !== "object" ||
        typeof right !== "object"
    ) {
        return false;
    }

    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    return (
        leftKeys.length === rightKeys.length &&
        leftKeys.every(
            (key) =>
                Object.hasOwn(right, key) &&
                AreDataValuesEqual(left[key], right[key]),
        )
    );
}
