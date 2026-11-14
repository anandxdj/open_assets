import type { Metadata } from "next";
import {
  Bullet,
  Bullets,
  External,
  Fill,
  Internal,
  LegalPage,
  LegalTable,
  PrivacyMail,
  Step,
  Steps,
  Sub,
  SupportMail,
  type LegalSectionData,
} from "@/components/marketing/LegalPage";

export const metadata: Metadata = {
  title: "Privacy policy · OpenAssets",
  description:
    "What OpenAssets collects, how uploaded images and AI processing are handled, which providers see your data, how long it is kept and how to delete it. Draft pending legal review.",
  alternates: { canonical: "/privacy" },
};

const SECTIONS: LegalSectionData[] = [
  {
    id: "who-we-are",
    title: "Who we are",
    body: (
      <>
        <p>
          OpenAssets (“we”, “us”) is run by <Fill>LEGAL ENTITY NAME</Fill>, <Fill>REGISTERED ADDRESS</Fill>. We
          operate the OpenAssets website, the API behind it and the OpenAssets browser extension, together called the
          Service.
        </p>
        <p>
          For the personal data described here we decide why and how it is used, so we are the controller. When you
          upload images, we process them on your behalf to give you the result you asked for.{" "}
          <Fill>COUNSEL TO CONFIRM the controller and processor split</Fill>
        </p>
        <p>
          Data protection contact: <Fill>DATA PROTECTION CONTACT</Fill>, <PrivacyMail />.
        </p>
      </>
    ),
  },
  {
    id: "data-we-collect",
    title: "What we collect",
    body: (
      <>
        <p>We collect only what the Service needs to work. Here is everything, by source.</p>
        <LegalTable
          caption="Personal data we collect"
          columns={["Category", "What it includes", "Where it comes from"]}
          rows={[
            [
              "Account",
              "Name, email address, a bcrypt hash of your password (never the password itself), whether your email is verified, your last sign-in time, your plan and your AI credit balance.",
              "You, when you register or sign in.",
            ],
            [
              "Google sign-in",
              "Name, email address, profile picture link and Google’s identifier for your account. We never see your Google password.",
              "Google, when you choose “Sign in with Google”.",
            ],
            [
              "Uploaded images",
              "The sprite sheets, icon grids, mockups and other images you upload (PNG, JPEG or WebP, up to 20 MB each), and the crops, names, tags and ZIP exports we make from them.",
              "You, when you upload. Our pipeline, when it processes them.",
            ],
            [
              "Job data",
              "Status, detected boxes, asset names and file links for each extraction.",
              "Our pipeline. Kept in Redis for 24 hours.",
            ],
            [
              "Collections",
              "Collection names, descriptions, tags, folders, images, likes and download counts. On a published collection, your name and profile picture are shown.",
              "You. Draft collections are also created automatically from each extraction.",
            ],
            [
              "Usage records",
              "Which AI tool you used, which model, how many AI credits it cost, whether the credits were refunded, and when.",
              "Our systems.",
            ],
            [
              "Extension",
              "For each connected browser: the extension’s ID, when it was last used, when its session expires, and a hashed device token.",
              "You, when you connect the extension.",
            ],
            [
              "API keys",
              "For each key you create: its name, the first characters of the key, a hash of the full key, when it was created and last used, and when you revoked it. We cannot show a key again after you create it.",
              "You, when you create a key. Our systems, when a key is used.",
            ],
            [
              "Email",
              "Your address and the content of verification and password-reset emails, plus anything you send to us for support.",
              "You. Our systems.",
            ],
            [
              "Technical",
              <>
                IP address and request details, which our servers and hosting provider process to serve pages, limit
                abuse and diagnose errors. <Fill>OWNER TO CONFIRM what is logged and for how long</Fill>
              </>,
              "Your browser or app.",
            ],
          ]}
        />
        <p>
          We do not knowingly collect special categories of data. Please do not upload images that contain them, such
          as identity documents or health records.
        </p>
      </>
    ),
  },
  {
    id: "how-we-use",
    title: "How we use it",
    body: (
      <>
        <Bullets>
          <Bullet>To run the Service: detect, name, crop, upscale and export the assets in your images.</Bullet>
          <Bullet>To create and secure your account, including verification and password-reset emails.</Bullet>
          <Bullet>To show and serve the collections you choose to publish.</Bullet>
          <Bullet>To count AI credits, apply plan limits and stop abuse, for example with rate limits.</Bullet>
          <Bullet>To fix bugs, keep the Service available and answer your messages.</Bullet>
          <Bullet>To meet legal obligations and defend legal claims.</Bullet>
        </Bullets>
        <p>
          We do not sell personal data. At the time of this draft the Service contains no analytics, advertising or
          session-replay scripts. If that changes we will update this policy first.
        </p>
      </>
    ),
  },
  {
    id: "legal-bases",
    title: "Legal bases",
    body: (
      <>
        <p>
          If the GDPR or UK GDPR applies to you, we rely on these bases. <Fill>COUNSEL TO REVIEW AND CONFIRM</Fill>
        </p>
        <Bullets>
          <Bullet>
            <strong>Contract.</strong> Creating your account, processing your images and delivering your exports.
          </Bullet>
          <Bullet>
            <strong>Legitimate interests.</strong> Security, abuse prevention, rate limiting, debugging and keeping the
            Service reliable. You can object, see “Your rights”.
          </Bullet>
          <Bullet>
            <strong>Consent.</strong> Where we ask for it, for example when you choose to add your own AI provider
            key. You can withdraw it at any time by removing the key.
          </Bullet>
          <Bullet>
            <strong>Legal obligation.</strong> Records and disclosures the law requires.
          </Bullet>
        </Bullets>
      </>
    ),
  },
  {
    id: "images-and-ai",
    title: "Your images and AI processing",
    body: (
      <>
        <p>This is what happens when you extract assets from an image:</p>
        <Steps>
          <Step n={1}>
            Your image goes to our API and is stored with our storage provider, Cloudinary by default or ImageKit if we
            switch to it.
          </Step>
          <Step n={2}>
            Our own Python service downloads it and uses OpenCV to find each asset. This step runs on our
            infrastructure and does not use an AI provider.
          </Step>
          <Step n={3}>
            When you crop, an AI model looks at the whole sheet to name the assets. The image is sent to Open Quota
            first and, if that fails, to Google’s Gemini API.
          </Step>
          <Step n={4}>
            When you crop, background removal runs, and when you export, upscaling does. The storage provider’s image
            add-ons do that work on the files stored there.
          </Step>
          <Step n={5}>We build a ZIP, store it with the provider and give you the link.</Step>
        </Steps>

        <Sub>Studio, Enhance and AniBuddy tools</Sub>
        <p>
          Prompts and images you submit to these tools go from your browser to our web server and then to Open Quota
          first, with OpenRouter as the fallback. OpenRouter is the only provider for Studio image generation and
          extending. OpenRouter routes the request to a model provider.
        </p>
        <p>
          If you add your own OpenRouter key, it is stored only in your browser’s local storage. Your browser sends it
          with each request, our server passes it to OpenRouter, and our code does not store or log it. Requests made
          with your own key do not go to Open Quota.
        </p>

        <Sub>Training and provider terms</Sub>
        <p>
          We do not use your images or prompts to train our own models. The AI providers above have their own terms
          about retention and training, and some providers, especially on free tiers, may keep prompts or use them to
          improve their models. We have not yet verified these terms for each provider.{" "}
          <Fill>OWNER TO CONFIRM provider terms and any zero-retention settings before launch</Fill> Do not upload
          images you are not willing to send to these providers.
        </p>

        <Sub>Links to your files</Sub>
        <p>
          Files at the storage provider are delivered through its CDN. Their links are long and hard to guess but are
          not access-controlled: anyone who has a link can open that file. Treat a link like an unlisted link.{" "}
          <Fill>OWNER TO CONFIRM the delivery type configured at the provider</Fill>
        </p>
      </>
    ),
  },
  {
    id: "processors",
    title: "Who else handles your data",
    body: (
      <>
        <p>
          We use these providers to run the Service. Each only receives what its job needs. Where we are not sure of
          a provider’s policy address we say so.
        </p>
        <LegalTable
          caption="Third-party providers and what they receive"
          columns={["Provider", "What it does for us", "What it receives", "Its policy"]}
          rows={[
            [
              "Cloudinary or ImageKit",
              "Stores originals, crops and exports, delivers them over a CDN, and (Cloudinary) runs background removal and upscaling.",
              "Your images and every file we generate from them.",
              <>
                <External href="https://cloudinary.com/privacy">Cloudinary</External>
                <br />
                <External href="https://imagekit.io/privacy-policy">ImageKit</External>
              </>,
            ],
            [
              "Google",
              "Optional “Sign in with Google”. Gemini API for asset naming when Open Quota cannot serve a request.",
              "Sign-in: your Google name, email and picture are sent to us. Gemini: the sheet image and a naming prompt.",
              <>
                <External href="https://policies.google.com/privacy">Google privacy policy</External>
              </>,
            ],
            [
              "Open Quota",
              "First choice for AI routing: asset naming, and Studio, Enhance and AniBuddy text and vision requests.",
              "Images and prompts you submit to those features.",
              <>
                See the provider’s privacy policy. <Fill>OWNER TO CONFIRM operator, policy address and onward providers</Fill>
              </>,
            ],
            [
              "OpenRouter",
              "Fallback AI routing, and the only provider for Studio image generation and extending. Uses your own key if you add one.",
              "Prompts and images for those features. Your OpenRouter key, if you add one.",
              <>
                <External href="https://openrouter.ai/privacy">OpenRouter privacy policy</External>
              </>,
            ],
            [
              "Resend",
              "Sends verification and password-reset emails.",
              "Your email address and the link in the message.",
              <>
                <External href="https://resend.com/legal/privacy-policy">Resend privacy policy</External>
              </>,
            ],
            [
              "Hosting provider",
              "Runs the website, API and Python service.",
              "Everything the Service processes, including server logs.",
              <>
                <Fill>HOSTING PROVIDER, REGION AND POLICY ADDRESS</Fill>
              </>,
            ],
            [
              "MongoDB and Redis",
              "MongoDB holds accounts, collections and usage records. Redis holds job state for 24 hours and the work queues.",
              "Account and collection data. Job state.",
              <>
                <Fill>OWNER TO CONFIRM self-hosted or a managed service</Fill>
              </>,
            ],
            [
              "Payment provider",
              "Takes payment for paid plans, once paid checkout is live.",
              "Billing details you enter at checkout.",
              <>
                <Fill>PAYMENT PROVIDER, IF ANY</Fill>
              </>,
            ],
          ]}
        />
        <p>
          We may disclose data when the law requires it, to protect people or the Service, or to a buyer if the
          business is sold. We will tell you if that happens and your data is affected.
        </p>
      </>
    ),
  },
  {
    id: "retention",
    title: "How long we keep things",
    body: (
      <>
        <LegalTable
          caption="Retention periods"
          columns={["Item", "Where", "How long"]}
          rows={[
            [
              "Job state",
              "Redis",
              "24 hours after its last update, then deleted automatically. The editor and download links for that job stop working.",
            ],
            [
              "Uploaded originals and ZIP exports",
              "Storage provider",
              <>
                Our code does not delete these when the 24-hour job state expires. They are removed when you delete
                your account, for the extractions still listed in History at that point. Older ones stay until we
                remove them. <Fill>OWNER TO CONFIRM retention period and cleanup job</Fill>
              </>,
            ],
            [
              "Collections, folders, images and likes",
              "MongoDB and storage provider",
              "Until you delete the collection, or an image in it. Deleting a collection removes its records and asks the storage provider to delete its image files. Each extraction also creates a private draft collection, so delete the draft to remove its crops.",
            ],
            [
              "Account record",
              "MongoDB",
              <>
                Until you delete your account in Settings. Deleting it removes your collections with their images,
                likes, usage records, monthly sheet counts, API keys, extension sessions and the extractions in
                History, and it dissolves a team you own. Stored image files are deleted on a best-effort basis.{" "}
                <Fill>OWNER TO CONFIRM backup retention after deletion</Fill>
              </>,
            ],
            [
              "Sign-in sessions",
              "Cookie and MongoDB",
              "The browser session lasts 7 days and ends when you sign out. An extension session lasts 30 days from last use and is revoked when you sign out in the extension.",
            ],
            [
              "API keys",
              "MongoDB (hashed)",
              "Until you revoke the key or delete the account. A revoked key’s record is deleted 90 days after you revoke it.",
            ],
            [
              "Verification and reset tokens",
              "MongoDB (hashed)",
              "Password-reset links expire after 15 minutes. Verification links are valid until used.",
            ],
            [
              "Usage records",
              "MongoDB",
              <>
                Kept for AI credit accounting. <Fill>OWNER TO CONFIRM period</Fill>
              </>,
            ],
            [
              "Server logs and backups",
              "Hosting provider",
              <>
                <Fill>LOG AND BACKUP RETENTION</Fill>
              </>,
            ],
            [
              "Emails you send us",
              "Our mailbox",
              <>
                As long as needed to deal with your request. <Fill>OWNER TO CONFIRM</Fill>
              </>,
            ],
          ]}
        />
      </>
    ),
  },
  {
    id: "cookies",
    title: "Cookies and local storage",
    body: (
      <>
        <p>
          We use one cookie and a few entries in your browser’s local storage. All of them are needed to run the
          Service or to remember your choices. At the time of this draft we use no analytics, advertising or
          cross-site tracking, so we show no cookie banner.{" "}
          <Fill>COUNSEL TO CONFIRM that no consent banner is needed in your target markets</Fill>
        </p>
        <LegalTable
          caption="Cookies and local storage used by the Service"
          columns={["Name", "Where", "What it does", "How long"]}
          rows={[
            [
              "refreshToken",
              "Cookie, httpOnly, Secure in production",
              "Keeps you signed in by letting the browser get a new short-lived access token.",
              "7 days, or until you sign out.",
            ],
            [
              "accessToken",
              "Local storage, and held in memory",
              "The short-lived sign-in token sent with API requests. It is 15 minutes by default.",
              "Until it is replaced or you sign out.",
            ],
            [
              "theme",
              "Local storage",
              "Remembers light, dark or system colours.",
              "Until you clear it.",
            ],
            [
              "oa.trial-intent",
              "Local storage",
              "Remembers that you clicked “Start 14-day trial” while signed out, so the trial can start after you sign in. It holds a timestamp.",
              "7 days, or until the trial starts.",
            ],
            [
              "oa:post-signin-next",
              "Session storage",
              "The page you were on when you chose to sign in, so you return to it afterwards.",
              "Until the tab closes or you sign in.",
            ],
            [
              "Studio settings",
              "Local storage",
              "Your OpenRouter key if you add one, the model you chose, your scene brief and the last tool you used.",
              "Until you remove them.",
            ],
            [
              "AniBuddy project",
              "Local storage",
              "Your in-progress AniBuddy project. Image pixels are not saved, only the project data.",
              "Until you clear it.",
            ],
          ]}
        />
        <Sub>Browser extension</Sub>
        <p>
          The extension acts only when you use it: from the context menu, the keyboard shortcut or the side panel. When
          you pick an image, the extension fetches it and uploads it to OpenAssets. The extension keeps your account
          details, device token, queue and library in the browser’s extension storage, and the short-lived access
          token in session storage. The queue and library stay in your browser and we do not receive them. When you
          generate images with the extension, it types your queued prompts and reference images into your own
          chatgpt.com tab and works inside your own session there. We never receive your ChatGPT credentials.
        </p>
      </>
    ),
  },
  {
    id: "security",
    title: "Security",
    body: (
      <>
        <p>We protect your data with measures that include:</p>
        <Bullets>
          <Bullet>Passwords are stored only as bcrypt hashes. Reset and verification tokens are stored hashed.</Bullet>
          <Bullet>The long-lived refresh token is in an httpOnly cookie that scripts cannot read.</Bullet>
          <Bullet>Rate limits on sign-in, password reset and upload endpoints, and security headers on the website and API.</Bullet>
          <Bullet>
            Access to the Python service is limited to our API with a shared secret.{" "}
            <Fill>OWNER TO CONFIRM the secret is enforced in production</Fill>
          </Bullet>
          <Bullet>
            Encryption in transit between you and the Service. <Fill>OWNER TO CONFIRM TLS setup and any encryption at rest</Fill>
          </Bullet>
        </Bullets>
        <p>
          No system is perfectly secure. If you find a vulnerability, please tell us at{" "}
          <Fill>SECURITY CONTACT</Fill> before you publish it, and we will work with you to fix it.
        </p>
      </>
    ),
  },
  {
    id: "transfers",
    title: "International transfers",
    body: (
      <p>
        Our providers run in several countries, and your data may be processed outside the country where you live. Where
        the law requires it, we rely on safeguards such as standard contractual clauses or an adequacy decision.{" "}
        <Fill>COUNSEL TO CONFIRM the transfer mechanism and the regions each provider uses</Fill>
      </p>
    ),
  },
  {
    id: "rights",
    title: "Your rights",
    body: (
      <>
        <p>Depending on where you live, you can ask us to:</p>
        <Bullets>
          <Bullet>give you a copy of your personal data (access and portability);</Bullet>
          <Bullet>correct data that is wrong;</Bullet>
          <Bullet>delete your data;</Bullet>
          <Bullet>restrict how we use it, or object to a use that relies on our legitimate interests;</Bullet>
          <Bullet>withdraw consent you gave, without affecting what happened before.</Bullet>
        </Bullets>
        <p>
          Email <PrivacyMail /> from the address on your account. We may ask you to confirm who you are. We aim to
          answer within one month. <Fill>COUNSEL TO CONFIRM response time</Fill>
        </p>
        <p>
          What you can do yourself today: delete collections and images, delete your account in Settings, sign out,
          clear local storage, and remove your own AI key. There is no data export button yet. For a copy of your
          data, email us and we will do it by hand.
        </p>
        <p>
          You can also complain to your data protection authority.{" "}
          <Fill>SUPERVISORY AUTHORITY AND ANY EU OR UK REPRESENTATIVE, IF REQUIRED</Fill> If US state privacy laws
          apply to you, additional disclosures may be needed. <Fill>COUNSEL TO ADD</Fill>
        </p>
      </>
    ),
  },
  {
    id: "children",
    title: "Children",
    body: (
      <p>
        The Service is not for children under <Fill>13 OR 16, TO CONFIRM FOR YOUR MARKETS</Fill>. We do not knowingly
        collect data from them. If you think a child has given us data, email <PrivacyMail /> and we will delete it.
      </p>
    ),
  },
  {
    id: "changes",
    title: "Changes to this policy",
    body: (
      <p>
        When we change this policy we will post the new version here with a new date. For changes that matter, we will
        also email you or tell you in the app <Fill>NOTICE PERIOD, TO CONFIRM</Fill> before they apply. The{" "}
        <Internal href="/terms">Terms of service</Internal> explain the rules for using the Service.
      </p>
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
          Privacy questions and requests: <PrivacyMail />
          <br />
          Everything else: <SupportMail />
        </p>
      </>
    ),
  },
];

export default function PrivacyPage() {
  return (
    <LegalPage
      slug="privacy"
      title={
        <>
          Privacy
          <br />
          policy
        </>
      }
      intro="What OpenAssets collects, who else sees it, how long it is kept and how to get it deleted, in plain language."
      related={{ label: "Terms of service", href: "/terms" }}
      sections={SECTIONS}
    />
  );
}
