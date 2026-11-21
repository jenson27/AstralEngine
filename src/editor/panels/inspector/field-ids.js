export const COMPONENT_ENABLED_FIELD_PREFIX = "component.enabled.";

export function GetComponentEnabledKey(fieldId) {
    return fieldId.startsWith(COMPONENT_ENABLED_FIELD_PREFIX)
        ? fieldId.slice(COMPONENT_ENABLED_FIELD_PREFIX.length)
        : null;
}
