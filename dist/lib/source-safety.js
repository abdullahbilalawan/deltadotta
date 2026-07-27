const secretPatterns = [
    { category: "private key", expression: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/ },
    { category: "OpenAI API key", expression: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/ },
    { category: "GitHub token", expression: /\bgithub_pat_[A-Za-z0-9_]{20,}\b|\bgh[pousr]_[A-Za-z0-9]{20,}\b/ },
    { category: "Slack token", expression: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/ },
    { category: "AWS access key", expression: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/ },
    {
        category: "credential-bearing connection URL",
        expression: /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|https?):\/\/[^:/@\s]+:[^/@\s]+@/i,
    },
];
/** Reports high-confidence credential patterns without returning matched values. */
export function findSourceSecrets(sources) {
    return sources.flatMap((source) => {
        const categories = secretPatterns
            .filter(({ expression }) => expression.test(source.content))
            .map(({ category }) => category);
        return categories.length ? [{ path: source.path, categories }] : [];
    });
}
