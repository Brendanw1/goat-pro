/**
 * Carries the title only. The glossary page is a Client Component (it filters
 * terms as you type), and Next forbids exporting `metadata` from one.
 */
export const metadata = { title: "Metric Glossary" };

export default function GlossaryLayout({ children }: { children: React.ReactNode }) {
  return children;
}
