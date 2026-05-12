import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const BASE_PROMPT = `You are generating a Git commit message that MUST follow Conventional Commits v1.0.0.

Analyze the staged changes and output exactly ONE commit message, with no code fences, no quotes, and no explanation.

# Rules:
- Use the format: <type>[optional scope]: <description>
- Use lowercase commit types.
- Prefer one of: feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert
- Add a scope only when it is clearly useful and specific.
- Keep the first line (header) under 72 characters.
- If the changes are complex, add a blank line and a detailed body explaining WHAT and WHY (not how).
- Use imperative mood (e.g., "add" not "added").
- Use \`BREAKING CHANGE:\` footer.
- If multiple disparate changes are detected, summarize them as a bulleted list in the commit body.

Return only the final commit message.`;

function formatSection(title: string, value: string) {
	const trimmed = value.trim();
	return `${title}:\n${trimmed.length > 0 ? trimmed : "(none)"}`;
}

async function runGit(pi: ExtensionAPI, args: string[]) {
	return pi.exec("git", args, { timeout: 30000 });
}

async function buildPrompt(pi: ExtensionAPI) {
	const [names, stat, diff] = await Promise.all([
		runGit(pi, ["diff", "--cached", "--name-only"]),
		runGit(pi, ["diff", "--cached", "--stat"]),
		runGit(pi, ["diff", "--cached"]),
	]);

	const stagedFiles = names.stdout.trim();
	if (!stagedFiles) {
		return null;
	}

	return `${BASE_PROMPT}

# Context:

${formatSection("Files changed", names.stdout)}

${formatSection("Diff summary", stat.stdout)}

${formatSection("Staged diff", diff.stdout)}`;
}

export default function conventionalCommitExtension(pi: ExtensionAPI) {
	pi.registerCommand("commitmsg", {
		description: "Generate a Conventional Commit message from staged changes",
		handler: async (_args, ctx) => {
			if (!ctx.isIdle()) {
				pi.sendUserMessage("/commitmsg", { deliverAs: "followUp" });
				ctx.ui.notify("Queued /commitmsg as a follow-up", "info");
				return;
			}

			try {
				const prompt = await buildPrompt(pi);
				if (!prompt) {
					ctx.ui.notify("No staged changes found", "info");
					return;
				}

				pi.sendUserMessage(prompt);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				ctx.ui.notify(`Failed to inspect staged changes: ${message}`, "error");
			}
		},
	});
}
