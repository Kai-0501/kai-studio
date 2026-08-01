import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { StudioChat } from "@/components/studio-chat";
import { findOwnedRepository } from "@/lib/github-vault";

export default async function GitHubCodingChatPage({ params }: { params: Promise<{ owner: string; repo: string }> }) {
  const { owner, repo } = await params;
  const repository = await findOwnedRepository(decodeURIComponent(owner), decodeURIComponent(repo));
  if (!repository) notFound();
  return <AppShell><StudioChat initialPrompt="Tell the two-agent build team what you want implemented." lockedModel="gemma4:31b-mlx" repositoryHandoff={{ owner: repository.owner, repo: repository.name, fullName: repository.fullName }} /></AppShell>;
}
