function text(value) { return value == null ? "" : String(value).trim(); }
const source = $("Restore and Validate Delivery Context").first().json;
const parts = text($json.stdout).split("\t");
if (parts[0] !== "OK") throw new Error(text($json.stderr) || "delivery_folder_validation_failed");
if (parts[1] !== text(source.resolved_folder_path)) throw new Error("delivery_folder_path_mismatch");
if (Number(parts[2]) !== Number(source.expected_clip_count)) throw new Error("delivery_folder_clip_count_mismatch");
return [{ json: { ...source, validated_folder_path: parts[1], validated_clip_count: Number(parts[2]) } }];
