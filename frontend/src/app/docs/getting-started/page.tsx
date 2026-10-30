import type { Metadata } from "next";
import { Bullet, Bullets, External, Internal, Step, Steps } from "@/components/marketing/LegalPage";
import { DocsPage, Ic } from "@/components/marketing/DocsPage";
import { DOCS_URL, SOCIAL } from "@/components/marketing/site";
import { ENTITLEMENT_TABLE } from "@/lib/plans";

export const metadata: Metadata = {
  title: "Getting started · OpenAssets Docs",
  description: "Make your first extraction with the OpenAssets web app or the Chrome extension, and the limits that apply.",
  alternates: { canonical: `${DOCS_URL}/getting-started` },
};

const EXTENSION_README = `${SOCIAL.github}/open_assets/tree/main/extension#readme`;

export default function GettingStartedPage() {
  return (
    <DocsPage
      page="getting-started"
      intro="Make your first extraction in a few minutes, in the browser or from any web page with the extension."
      sections={{
        account: (
          <>
            <p>
              Create an account with your email and a password, or sign in with Google. If you register with email,
              open the verification link we send before you sign in.
            </p>
            <p>
              A new account is on the Free plan: {ENTITLEMENT_TABLE.free.sheetsPerMonth} sheets a month and exports up
              to {ENTITLEMENT_TABLE.free.maxUpscale}×. See <Internal href={DOCS_URL}>Plans and limits</Internal> for
              what Pro adds.
            </p>
          </>
        ),
        "web-app": (
          <>
            <Steps>
              <Step n={1}>
                Open <Internal href="/upload">Extract</Internal> and drop in a sheet, an icon grid or a mockup. Detection
                starts at once.
              </Step>
              <Step n={2}>
                In the editor, check the boxes around each asset and correct the ones that are wrong. On Pro you can also
                change how sensitive detection is and add padding around every box.
              </Step>
              <Step n={3}>
                Confirm the boxes to crop. Backgrounds are removed and every asset gets a name.
              </Step>
              <Step n={4}>
                On the export screen choose the assets you want. Turn on upscaling for 2× (or 4× on Pro) and download the
                ZIP of PNGs. On Pro the Naming control sets how the files are named, for example{" "}
                <Ic>{"{sheet}_{index:03}_{name}"}</Ic>. Save a default pattern under{" "}
                <Internal href="/settings#export">Settings, Export</Internal>.
              </Step>
            </Steps>
            <p>
              Past extractions are listed in <Internal href="/history">History</Internal> for 24 hours. Each extraction
              also leaves a private draft collection in your library, which you can publish or delete.
            </p>
          </>
        ),
        extension: (
          <>
            <p>
              The Chrome extension sends an image from any web page to your account and opens it in the editor, so
              there is no download and re-upload.
            </p>
            <Steps>
              <Step n={1}>
                Build the extension from the repository and load it unpacked in Chrome. The steps are in the{" "}
                <External href={EXTENSION_README}>extension README</External>.
              </Step>
              <Step n={2}>
                Open its side panel and choose <strong>Connect account</strong>. You sign in on the OpenAssets website,
                so your password never goes to the extension.
              </Step>
              <Step n={3}>
                Right-click any image and choose <strong>Extract with OpenAssets</strong>, or press{" "}
                <kbd className="oa-kbd">Alt</kbd> <kbd className="oa-kbd">Shift</kbd> <kbd className="oa-kbd">E</kbd>{" "}
                to extract the last image you selected.
              </Step>
            </Steps>
            <p>
              Each connected browser is listed in <Internal href="/settings#security">Settings</Internal>, where you can
              disconnect it. Signing out of all devices, or changing your password, disconnects every browser and the
              extension at once.
            </p>
          </>
        ),
        limits: (
          <Bullets>
            <Bullet>
              Images: PNG, JPEG or WebP, up to 20 MB, between 64 and 12,000 pixels on each side.
            </Bullet>
            <Bullet>
              Sheets: {ENTITLEMENT_TABLE.free.sheetsPerMonth} a month on Free, unlimited on Pro. The count resets on the
              first day of each month (UTC). An upload that fails does not use up a sheet.
            </Bullet>
            <Bullet>
              Jobs: kept for 24 hours after their last change, then removed from History.
            </Bullet>
            <Bullet>
              Detection is automatic and imperfect, so check the boxes before you crop. The <Ic>asset_001</Ic> style
              names you see before cropping are placeholders.
            </Bullet>
            <Bullet>
              Want to run this from code? Pro accounts can create API keys. See the{" "}
              <Internal href={`${DOCS_URL}/api`}>API reference</Internal>.
            </Bullet>
          </Bullets>
        ),
      }}
    />
  );
}
