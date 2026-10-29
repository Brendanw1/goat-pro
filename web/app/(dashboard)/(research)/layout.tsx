import { ResearchToc } from "@/components/research-toc";

export default function ResearchLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <ResearchToc />
      {children}
    </>
  );
}
