function normalizeString(str) {
    if (!str) return "";
    return str.trim().toLowerCase();
}

module.exports = { normalizeString };
