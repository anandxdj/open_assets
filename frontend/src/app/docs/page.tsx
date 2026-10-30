import type { Metadata } from "next";
import { Bullet, Bullets, Internal, LegalTable, Step, Steps } from "@/components/marketing/LegalPage";
import { DocsPage, Ic } from "@/components/marketing/DocsPage";
import { DOCS_URL } from "@/components/marketing/site";
import { ENTITLEMENT_TABLE, TRIAL_DAYS } from "@/lib/plans";

export const metadata: Metadata = {
  title: "Docs · OpenAssets",
  description:
    "How OpenAssets turns one sprite sheet, icon grid or UI mockup into named, transparent PNGs, and the three ways to use it: the web app, the Chrome extension and the API.",
  alternates: { canonical: DOCS_URL },
};

const FREE = ENTITLEMENT_TABLE.free;
const PRO = ENTITLEMENT_TABLE.pro;

export default function DocsOverviewPage() {
  return (
    <DocsPage
      page="overview"
      intro="OpenAssets finds every asset on one large image, names it and hands you a ZIP of transparent PNGs. These pages cover the web app, the Chrome extension and the API."
      sections={{
        what: (
          <>
            <p>
              Drop in one packed image: a sprite sheet, an icon grid, a UI mockup. OpenAssets detects each individual
              asset, cuts it out, removes the background, names it, and gives you a ZIP of transparent PNGs. You can
              upscale the result when you export it.
            </p>
            <p>
              The image does not need a transparent background to start. When it has none, background removal runs
              before the assets are cut.
            </p>
          </>
        ),
        how: (
          <>
            <Steps>
              <Step n={1}>
                <strong>Upload.</strong> A PNG, JPEG or WebP image starts a job. Detection finds a box around every
                asset on the sheet.
              </Step>
              <Step n={2}>
                <strong>Review.</strong> Check the boxes. Correct any that are wrong, then confirm them.
              </Step>
              <Step n={3}>
                <strong>Crop.</strong> Each box is cut out of the sheet with its background removed, and an AI model
                names it. If naming is not available the assets keep plain names such as <Ic>asset_001</Ic>.
              </Step>
              <Step n={4}>
                <strong>Export.</strong> Pick the assets you want, rename any, choose an upscale factor if you like and
                download the ZIP.
              </Step>
            </Steps>
            <p>
              A job is kept for 24 hours after its last change. Download the ZIP or save the assets to a collection
              before then.
            </p>
          </>
        ),
        "ways-in": (
          <LegalTable
            caption="The three ways to use OpenAssets"
            columns={["Way", "Best for", "How"]}
            rows={[
              [
                "Web app",
                "Sheets you want to look over by hand",
                <>
                  Upload, review the boxes and export in the browser. See{" "}
                  <Internal href={`${DOCS_URL}/getting-started`}>Getting started</Internal>.
                </>,
              ],
              [
                "Chrome extension",
                "An image you meet on a web page",
                <>
                  Right-click the image and choose Extract with OpenAssets. It opens in the editor. See{" "}
                  <Internal href={`${DOCS_URL}/getting-started#extension`}>the extension</Internal>.
                </>,
              ],
              [
                "API",
                "Scripts, build steps and your own tools (Pro)",
                <>
                  The same pipeline over HTTP with an API key. See the{" "}
                  <Internal href={`${DOCS_URL}/api`}>API reference</Internal>.
                </>,
              ],
            ]}
          />
        ),
        plans: (
          <>
            <LegalTable
              caption="What each plan includes"
              columns={["Feature", "Free", "Pro"]}
              rows={[
                ["Sheets per month", String(FREE.sheetsPerMonth), PRO.sheetsPerMonth === null ? "Unlimited" : String(PRO.sheetsPerMonth)],
                ["Upscale on export", `Up to ${FREE.maxUpscale}×`, `Up to ${PRO.maxUpscale}×`],
                [
                  "Padding and threshold controls",
                  FREE.paddingThresholdControls ? "Yes" : "No",
                  PRO.paddingThresholdControls ? "Yes" : "No",
                ],
                ["API keys", FREE.apiKeys > 0 ? String(FREE.apiKeys) : "None", String(PRO.apiKeys)],
              ]}
            />
            <p>
              Sheets are counted per calendar month in UTC. Every account can start a {TRIAL_DAYS}-day Pro trial once,
              from <Internal href="/pricing">Pricing</Internal> or Settings. When a Pro period ends the account goes
              back to Free: your jobs and collections stay, and your API keys stay listed but stop working until you
              are on Pro again.
            </p>
          </>
        ),
        next: (
          <Bullets>
            <Bullet>
              <Internal href={`${DOCS_URL}/getting-started`}>Getting started</Internal>: your first extraction, in the
              web app or the extension.
            </Bullet>
            <Bullet>
              <Internal href={`${DOCS_URL}/api`}>API reference</Internal>: create a key and run the pipeline from code.
            </Bullet>
            <Bullet>
              <Internal href="/pricing">Pricing</Internal>: the plans side by side.
            </Bullet>
          </Bullets>
        ),
      }}
    />
  );
}
