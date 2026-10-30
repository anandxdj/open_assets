import type { Metadata } from "next";
import { ArrowUpRight, CircleDashed, CircleDot, Clock, Code2, Cpu, Smartphone, type LucideIcon } from "lucide-react";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MarketingFooter } from "@/components/marketing/MarketingFooter";
import { MarketingHeader } from "@/components/marketing/MarketingHeader";
import { SectionHeader } from "@/components/marketing/SectionHeader";
import { SOCIAL, WRAP } from "@/components/marketing/site";

export const metadata: Metadata = {
  title: "Careers · OpenAssets",
  description: "Build major open-source projects with me. Full-stack builders and engineers welcome.",
  alternates: { canonical: "/careers" },
};

type Status = { label: string; tone: NonNullable<BadgeProps["tone"]>; icon: LucideIcon };

const STATUS: Record<"planned" | "in_progress" | "starting", Status> = {
  planned: { label: "Planned", tone: "neutral", icon: Clock },
  in_progress: { label: "In progress", tone: "info", icon: CircleDot },
  starting: { label: "Just starting", tone: "neutral", icon: CircleDashed },
};

const PROJECTS: {
  id: string;
  title: string;
  subtitle: string;
  description: string;
  icon: LucideIcon;
  status: keyof typeof STATUS;
  scope: string;
  stack: string[];
  requirements: string[];
}[] = [
  {
    id: "hashnode-clone",
    title: "Hashnode clone",
    subtitle: "Developer blogging platform",
    description:
      "A high-performance, developer-first blogging platform and community dashboard. Optimized for markdown syntax highlighting, collaborative team blogs, custom subdomains, and ultra-fast static rendering.",
    icon: Code2,
    status: "planned",
    scope: "Large scale",
    stack: ["Next.js 15", "React 19", "Tailwind CSS", "MDX compiler", "Redis"],
    requirements: [
      "Deep understanding of modern React and Next.js architectures",
      "Ability to read, trace and refine complex codebases",
      "Passionate about creating clean, production-grade components",
    ],
  },
  {
    id: "tool-sadhan",
    title: "Tool Sadhan",
    subtitle: "Browser toolkit",
    description:
      "An open-source browser toolkit extension that helps developers debug layout boundaries, measure viewport performance, grab assets instantly, and capture visual elements directly in the browser.",
    icon: Cpu,
    status: "in_progress",
    scope: "Active contribution",
    stack: ["Chrome extensions", "TypeScript", "Canvas API", "Tailwind", "Vite"],
    requirements: [
      "Experience with Chrome extension APIs and content scripts",
      "Strong background in canvas rendering and DOM manipulation",
      "Loves creating lightweight developer utilities",
    ],
  },
  {
    id: "calorie-tracker",
    title: "OpenCV health tracker",
    subtitle: "Mobile image analysis platform",
    description:
      "A comprehensive health and nutrition tracker for mobile devices. Powered by local OpenCV compilation to identify foods, estimate calorie metrics, and outline meal items in real time through image contour detection.",
    icon: Smartphone,
    status: "starting",
    scope: "Full app",
    stack: ["React Native / Capacitor", "OpenCV (JS/WASM)", "Gemini Vision API", "SQLite"],
    requirements: [
      "Capable of integrating OpenCV JS/WASM or native wrappers in mobile packages",
      "Solid understanding of computer vision and contour tracking algorithms",
      "Ready to build high-performance mobile UI",
    ],
  },
];

const FACTS = [
  { label: "Host", value: "anandxdj, creator" },
  { label: "Looking for", value: "Full-stack builders and engineers" },
  { label: "Community", value: "Open source and indie hackers" },
  { label: "Mission", value: "Create something big", accent: true },
];

function NewTab() {
  return <span className="sr-only"> (opens in a new tab)</span>;
}

export default function CareersPage() {
  return (
    <div className="flex min-h-screen flex-col bg-page text-ink">
      <MarketingHeader />
      <main className="flex-1">
        <section aria-labelledby="careers-title" className={`${WRAP} flex flex-col gap-10 pb-16 pt-12 md:pt-[72px]`}>
          <div className="flex flex-col gap-6">
            <span className="oa-eyebrow">Careers</span>
            <h1 id="careers-title" className="oa-display text-[clamp(36px,6.4vw,88px)] leading-[.95]">
              Build major projects
              <br />
              <span className="bg-brand px-[.12em] text-brand-fg">with me</span>
            </h1>
          </div>
          <div className="flex flex-wrap items-end justify-between gap-x-12 gap-y-6">
            <p className="oa-lead max-w-[600px]">
              No busywork and no repetitive corporate meetings. Just fast, open-source engineering on projects worth
              shipping. Let’s create something big.
            </p>
            <Button asChild variant="primary" size="lg" className="max-sm:w-full">
              <a href={SOCIAL.x} target="_blank" rel="noopener noreferrer">
                Message me on X
                <ArrowUpRight aria-hidden />
                <NewTab />
              </a>
            </Button>
          </div>

          <dl className="grid gap-[1.5px] border-2 border-line-strong bg-line-strong sm:grid-cols-2 lg:grid-cols-4">
            {FACTS.map((fact) => (
              <div
                key={fact.label}
                className={
                  fact.accent
                    ? "flex flex-col gap-1 bg-brand px-[18px] py-3.5 text-brand-fg"
                    : "flex flex-col gap-1 bg-surface px-[18px] py-3.5"
                }
              >
                <dt className={fact.accent ? "oa-label text-brand-fg" : "oa-label"}>{fact.label}</dt>
                <dd className="text-xs font-bold leading-[18px]">{fact.value}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section
          aria-labelledby="projects-title"
          className="border-t-2 border-line-strong bg-sunken"
        >
          <div className={`${WRAP} flex flex-col gap-8 py-16 md:py-[88px]`}>
            <SectionHeader eyebrow="Open ideas" titleId="projects-title" title="Projects looking for builders" />
            <ul className="grid gap-[2px] border-2 border-line-strong bg-line-strong lg:grid-cols-3">
              {PROJECTS.map((project) => {
                const Icon = project.icon;
                const status = STATUS[project.status];
                const StatusIcon = status.icon;
                return (
                  <li key={project.id} className="flex flex-col bg-surface">
                    <article aria-labelledby={`${project.id}-title`} className="flex flex-1 flex-col gap-5 p-6 md:p-7">
                      <div className="flex items-start justify-between gap-3">
                        <span className="oa-icon-box">
                          <Icon aria-hidden className="size-5" />
                        </span>
                        <Badge tone={status.tone}>
                          <StatusIcon aria-hidden />
                          {status.label}
                        </Badge>
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <h3 id={`${project.id}-title`} className="oa-h3">
                          {project.title}
                        </h3>
                        <p className="oa-label">{project.subtitle}</p>
                      </div>
                      <p className="text-xs leading-[18px] text-ink-2">{project.description}</p>

                      <div className="flex flex-col gap-2">
                        <h4 className="oa-label text-ink-3">Stack</h4>
                        <ul className="flex flex-wrap gap-1.5">
                          {project.stack.map((item) => (
                            <li key={item} className="oa-value border border-line px-1.5 py-0.5">
                              {item}
                            </li>
                          ))}
                        </ul>
                      </div>

                      <div className="flex flex-col gap-1">
                        <h4 className="oa-label text-ink-3">What you will bring</h4>
                        <ul className="flex flex-col text-xs leading-[18px]">
                          {project.requirements.map((req) => (
                            <li key={req} className="flex gap-2.5 border-t border-rule py-[9px] first:border-t-0">
                              <span aria-hidden className="oa-value leading-[18px] text-brand-text">
                                +
                              </span>
                              {req}
                            </li>
                          ))}
                        </ul>
                      </div>

                      <div className="mt-auto flex items-center justify-between gap-3 border-t-[1.5px] border-line pt-4">
                        <p className="text-[11px] leading-4 text-ink-2">
                          <span className="oa-label text-ink-3">Scope</span> {project.scope}
                        </p>
                        <Button asChild variant="secondary" size="sm">
                          <a href={SOCIAL.x} target="_blank" rel="noopener noreferrer">
                            Connect
                            <ArrowUpRight aria-hidden />
                            <span className="sr-only"> about {project.title} (opens in a new tab)</span>
                          </a>
                        </Button>
                      </div>
                    </article>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>

        <section aria-labelledby="contact-title" className="border-t-2 border-line-strong bg-ink text-page">
          <div className={`${WRAP} flex flex-wrap items-end justify-between gap-8 py-16 md:py-[88px]`}>
            <div className="flex max-w-[640px] flex-col gap-3.5">
              <span className="oa-eyebrow">Get in touch</span>
              <h2 id="contact-title" className="oa-h1 max-md:text-[30px] max-md:leading-[32px]">
                Ready to build with me?
              </h2>
              <p className="text-xs leading-[18px] opacity-75">
                Send me a direct message on X. Tell me which project fits you and link your GitHub or portfolio, and
                we will plan what to build together.
              </p>
            </div>
            <Button
              asChild
              variant="primary"
              size="xl"
              className="shadow-[4px_4px_0_var(--oa-bg)] focus-visible:outline-page max-sm:w-full"
            >
              <a href={SOCIAL.x} target="_blank" rel="noopener noreferrer">
                Message me on X
                <ArrowUpRight aria-hidden />
                <NewTab />
              </a>
            </Button>
          </div>
        </section>
      </main>
      <MarketingFooter />
    </div>
  );
}
