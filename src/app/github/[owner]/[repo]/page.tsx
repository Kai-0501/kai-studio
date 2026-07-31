import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { GitHubRepositoryDetail } from "@/components/github-repository-detail";
import { findOwnedRepository } from "@/lib/github-vault";

export default async function GitHubRepositoryPage({ params }: { params: Promise<{ owner: string; repo: string }> }) {
  const { owner, repo } = await params;
  const repository = await findOwnedRepository(decodeURIComponent(owner), decodeURIComponent(repo));
  if (!repository) notFound();
  return <AppShell><GitHubRepositoryDetail repository={repository} /></AppShell>;
}
