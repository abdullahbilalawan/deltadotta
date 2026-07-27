export const providerKnowledgeLimits = {
    chatgpt: {
        maxBytesPerFile: 1_800_000,
        maxProjectFiles: 40,
        reservedProjectFiles: 3,
        officialLimits: "https://help.openai.com/en/articles/10169521-projects-in-chatgpt",
    },
    claude: {
        maxBytesPerFile: 25_000_000,
        reservedProjectFiles: 3,
        officialLimits: "https://support.claude.com/en/articles/8241126-upload-files-to-claude",
    },
};
export function providerHandoffArtifactPaths(provider) {
    return [
        `providers/${provider}/PROJECT-INSTRUCTIONS.md`,
        ...(provider === "chatgpt" ? ["providers/chatgpt/GPT-INSTRUCTIONS.md"] : []),
        "ORGANIZATION.md",
        "GAPS.md",
        `providers/${provider}/UPLOAD-MANIFEST.md`,
        `providers/${provider}/INSTALL.md`,
        "validation/provider-evaluation-cases.json",
        "validation/provider-evaluation-cases.md",
    ];
}
