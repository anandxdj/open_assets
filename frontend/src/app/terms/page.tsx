import type { Metadata } from "next";
import {
  Bullet,
  Bullets,
  External,
  Fill,
  Internal,
  LegalPage,
  Mail,
  PrivacyMail,
  SupportMail,
  type LegalSectionData,
} from "@/components/marketing/LegalPage";
import { SALES_EMAIL } from "@/components/marketing/site";

export const metadata: Metadata = {
  title: "Terms of service · OpenAssets",
  description:
    "The rules for using OpenAssets: accounts, your images and collections, acceptable use, AI output, plans and liability. Draft pending legal review.",
  alternates: { canonical: "/terms" },
};

const SECTIONS: LegalSectionData[] = [
  {
    id: "acceptance",
    title: "Accepting these terms",
    body: (
      <>
        <p>
          These terms are an agreement between you and <Fill>LEGAL ENTITY NAME</Fill>, <Fill>REGISTERED ADDRESS</Fill>{" "}
          (“we”, “us”). They cover the OpenAssets website, API and browser extension, together called the Service.
        </p>
        <p>
          By creating an account or using the Service you accept these terms and our{" "}
          <Internal href="/privacy">Privacy policy</Internal>. If you use the Service for a company, you confirm you
          can bind it. If you do not agree, do not use the Service.
        </p>
      </>
    ),
  },
  {
    id: "service",
    title: "The Service",
    body: (
      <>
        <p>
          OpenAssets finds the individual assets in one large image, such as a sprite sheet, icon grid or UI mockup,
          names them, crops them to transparent PNGs and exports them as a ZIP. It can remove backgrounds and upscale
          2×. You can keep assets in collections and publish them for others. The Service also includes a browser
          extension and AI tools for Studio, Enhance and AniBuddy. Some of these tools may be marked “coming soon”.
        </p>
        <p>The things you should know before you rely on it:</p>
        <Bullets>
          <Bullet>
            You can upload PNG, JPEG and WebP images up to 20 MB, between 64 and 12,000 pixels on each side.
          </Bullet>
          <Bullet>
            The result of an extraction is kept as a job for 24 hours. Download your ZIP or save the assets to a
            collection before then.
          </Bullet>
          <Bullet>
            Detection is automatic and imperfect. It can miss, merge or split assets, so check the boxes before you
            crop.
          </Bullet>
          <Bullet>
            We may change, pause or remove features, and the Service may be unavailable at times. We will try to give
            notice of changes that remove something you rely on.
          </Bullet>
        </Bullets>
      </>
    ),
  },
  {
    id: "accounts",
    title: "Your account",
    body: (
      <>
        <p>
          You need an account for most of the Service. You can register with an email address and password or sign in
          with Google. Give us accurate details and verify your email.
        </p>
        <Bullets>
          <Bullet>
            You must be at least <Fill>13 OR 16, TO CONFIRM</Fill> years old, or older if your country sets a higher
            age for this kind of service.
          </Bullet>
          <Bullet>One account is for one person. Do not share your password.</Bullet>
          <Bullet>
            You are responsible for what happens under your account, including sessions you connect in the browser
            extension. Tell us at <SupportMail /> if you think someone else has access.
          </Bullet>
        </Bullets>
      </>
    ),
  },
  {
    id: "acceptable-use",
    title: "Acceptable use",
    body: (
      <>
        <p>You agree not to:</p>
        <Bullets>
          <Bullet>
            upload or publish anything you do not have the right to use, or that infringes someone else’s copyright,
            trademark, privacy or other rights;
          </Bullet>
          <Bullet>
            upload or publish anything illegal, including any sexual content involving minors, which we will report;
          </Bullet>
          <Bullet>upload malware, or use the Service to attack, probe or overload anyone;</Bullet>
          <Bullet>
            get around rate limits, plan limits or credits, scrape the Service, or resell access to the API without our
            written permission;
          </Bullet>
          <Bullet>reverse engineer the Service, except where the law lets you;</Bullet>
          <Bullet>harass others or publish content that is hateful or threatens people.</Bullet>
        </Bullets>
        <p>We may remove content and suspend accounts that break these rules.</p>
      </>
    ),
  },
  {
    id: "your-content",
    title: "Your content and our licence",
    body: (
      <>
        <p>
          You keep ownership of the images you upload and of the assets we cut from them. We do not claim them.
        </p>
        <p>
          To run the Service for you, you give us a worldwide, non-exclusive, royalty-free licence to store, process,
          copy, transmit and display your content. That includes sending it to the providers listed in our{" "}
          <Internal href="/privacy#processors">Privacy policy</Internal>, such as the storage provider and the AI
          providers that name your assets. The licence is only for providing the Service to you, and ends when your
          content is deleted, except for backups and copies we need to keep by law. We do not use your content to train
          our own models.
        </p>
        <p>
          You promise that you have the rights needed to upload your content and give us this licence, and you are
          responsible for claims that your content causes.
        </p>
      </>
    ),
  },
  {
    id: "collections",
    title: "Public collections",
    body: (
      <>
        <p>
          Collections are private drafts until you publish them. Each extraction creates a draft for you
          automatically. Once you publish a collection, anyone can see it, with your name and picture, and anyone can
          like and download it. Unpublish or delete it to take it down. Copies people already downloaded cannot be
          recalled.
        </p>
        <p>
          <strong>Licence to other users.</strong> Unless you say otherwise in the collection description, by
          publishing a collection you let other users download the assets in it and use them in their own projects,
          including commercial ones, worldwide and free of charge. This is draft wording.{" "}
          <Fill>OWNER AND COUNSEL TO DECIDE the default licence for published collections</Fill>
        </p>
        <p>
          We may review, remove or hide any published content that breaks these terms or the law, and we do not
          promise to check content before it goes live.
        </p>
      </>
    ),
  },
  {
    id: "ai",
    title: "AI features and output",
    body: (
      <>
        <p>
          Some features use AI: asset names and tags, the briefs and reviews in Studio, generated or extended images,
          and AniBuddy animation. AI output can be wrong, can be similar to what it gives other people, and may not be
          protected by copyright. Check it before you use it. You are responsible for how you use it.
        </p>
        <p>
          If you add your own AI provider key, you pay that provider directly and its terms apply to your requests.
          Credits shown in the app limit how much AI you can use on our keys, and can change.
        </p>
      </>
    ),
  },
  {
    id: "plans",
    title: "Plans, credits and fees",
    body: (
      <>
        <p>
          The plans, their limits and their prices are shown on the <Internal href="/pricing">pricing page</Internal>.
          Hobby is free. Pro and Enterprise are paid. For Enterprise, contact <Mail address={SALES_EMAIL} />. Plans and
          prices can change. If a price change affects a paid plan you are on, we will tell you <Fill>NOTICE PERIOD</Fill>{" "}
          before it applies.
        </p>
        <p>
          How payment, renewal, cancellation, refunds and taxes work will be set out when paid checkout is available.{" "}
          <Fill>BILLING TERMS: payment provider, renewal, cancellation, refunds and taxes</Fill>
        </p>
      </>
    ),
  },
  {
    id: "third-party",
    title: "Third-party services",
    body: (
      <>
        <p>
          The Service depends on other companies, including storage, AI and email providers and Google sign-in. We are
          not responsible for their outages or changes. Where you deal with them directly, for example with your own
          OpenRouter key or your Google account, their terms apply to you.
        </p>
        <p>
          The browser extension can queue prompts and run them in your own ChatGPT tab. It works inside your own
          session, we never see your ChatGPT login, and you must follow OpenAI’s terms when you use it. We are not
          affiliated with OpenAI. Changes to the ChatGPT website can break this feature without notice.
        </p>
      </>
    ),
  },
  {
    id: "ip",
    title: "Our property",
    body: (
      <>
        <p>
          The Service, including its software, design, name and logo, belongs to us or our licensors. We give you a
          limited, non-exclusive, non-transferable right to use it under these terms. Parts of the Service are built on
          open-source software under their own licences, including Studio code adapted from{" "}
          <External href="https://github.com/boona13/image-extender">image-extender</External> by boona13 (MIT licence).
        </p>
        <p>If you send us feedback, we may use it without owing you anything.</p>
      </>
    ),
  },
  {
    id: "takedown",
    title: "Copyright and takedown",
    body: (
      <>
        <p>
          If you think something on the Service infringes your copyright, send a notice to{" "}
          <Fill>COPYRIGHT CONTACT NAME AND EMAIL</Fill>. Please include:
        </p>
        <Bullets>
          <Bullet>the work you say is infringed;</Bullet>
          <Bullet>the address of the collection or file you object to;</Bullet>
          <Bullet>your name, address, email and phone number;</Bullet>
          <Bullet>a statement that you believe in good faith the use is not allowed, and that your notice is accurate;</Bullet>
          <Bullet>your signature, which may be electronic.</Bullet>
        </Bullets>
        <p>
          We may remove the content and tell the person who published it, who can reply. We may close the accounts of
          people who repeatedly infringe. <Fill>COUNSEL TO CONFIRM the notice and counter-notice procedure, for example under the US DMCA</Fill>
        </p>
      </>
    ),
  },
  {
    id: "disclaimers",
    title: "No warranty",
    body: (
      <p>
        The Service is provided “as is” and “as available”. To the extent the law allows, we do not promise that it will
        be uninterrupted or error-free, that detection or AI output will be accurate, or that it fits your purpose. You
        are responsible for keeping your own copies of your files, because job results expire after 24 hours. Rights you
        have under consumer law that cannot be excluded are not affected.
      </p>
    ),
  },
  {
    id: "liability",
    title: "Limit of liability",
    body: (
      <>
        <p>
          To the extent the law allows, we are not liable for indirect or consequential loss, or for lost profit, data
          or goodwill. Our total liability to you for any claim about the Service is limited to the greater of what you
          paid us in the 12 months before the claim and <Fill>LIABILITY CAP AMOUNT</Fill>.
        </p>
        <p>
          Nothing here limits liability that the law does not allow us to limit, such as for death or personal injury
          caused by negligence, or for fraud. <Fill>COUNSEL TO REVIEW this section and add an indemnity clause if wanted</Fill>
        </p>
      </>
    ),
  },
  {
    id: "termination",
    title: "Ending your use",
    body: (
      <>
        <p>
          You can stop using the Service at any time. You can delete your collections yourself. To close your account,
          email <SupportMail />.
        </p>
        <p>
          We may suspend or close an account if you break these terms, put the Service or others at risk, or the law
          requires it. We will tell you why where we can. What these terms say about ownership, warranties, liability
          and governing law continues after your account ends. What we do with your data afterwards is described in the{" "}
          <Internal href="/privacy#retention">Privacy policy</Internal>.
        </p>
      </>
    ),
  },
  {
    id: "law",
    title: "Governing law",
    body: (
      <p>
        These terms are governed by the law of <Fill>GOVERNING LAW / JURISDICTION</Fill>, and its courts in{" "}
        <Fill>COURTS / VENUE</Fill> decide disputes, except where the law of your country gives you the right to go to
        court there. Before you start a claim, please email <SupportMail /> so we can try to settle it.
      </p>
    ),
  },
  {
    id: "changes",
    title: "Changes and general terms",
    body: (
      <>
        <p>
          We may update these terms. We will post the new version here with a new date, and for changes that matter we
          will email you or tell you in the app <Fill>NOTICE PERIOD</Fill> before they apply. If you keep using the
          Service after that, you accept the new terms. If you do not, stop using it.
        </p>
        <p>
          These terms, the Privacy policy and the pricing page are the whole agreement between us about the Service. If
          part of these terms cannot be enforced, the rest still applies. If we do not enforce a right straight away, we
          have not given it up. You may not transfer your rights under these terms without our consent.
        </p>
      </>
    ),
  },
  {
    id: "contact",
    title: "Contact",
    body: (
      <>
        <p>
          <Fill>LEGAL ENTITY NAME</Fill>
          <br />
          <Fill>REGISTERED ADDRESS</Fill>
        </p>
        <p>
          Help and account questions: <SupportMail />
          <br />
          Enterprise and sales: <Mail address={SALES_EMAIL} />
          <br />
          Privacy: <PrivacyMail />
        </p>
      </>
    ),
  },
];

export default function TermsPage() {
  return (
    <LegalPage
      slug="terms"
      title={
        <>
          Terms of
          <br />
          service
        </>
      }
      intro="The rules for using OpenAssets: what you can do, what you are responsible for and what we promise, in plain language."
      related={{ label: "Privacy policy", href: "/privacy" }}
      sections={SECTIONS}
    />
  );
}
