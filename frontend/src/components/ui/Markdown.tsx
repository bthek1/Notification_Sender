import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { cn } from "@/lib/utils";

interface MarkdownProps {
  /** Raw markdown source (e.g. streamed LLM output). */
  children: string;
  className?: string;
}

/**
 * Renders markdown (GitHub-flavored) as styled HTML. Intended for displaying
 * model output. Tailwind `prose` is not required — element styles are applied
 * via the wrapper's typography utilities.
 */
export function Markdown({ children, className }: MarkdownProps) {
  return (
    <div
      data-slot="markdown"
      className={cn(
        "space-y-3 text-sm leading-relaxed [&_a]:font-medium [&_a]:text-primary [&_a]:underline [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-xs [&_h1]:text-lg [&_h1]:font-semibold [&_h2]:text-base [&_h2]:font-semibold [&_li]:ml-4 [&_ol]:list-decimal [&_ul]:list-disc",
        className
      )}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  );
}
