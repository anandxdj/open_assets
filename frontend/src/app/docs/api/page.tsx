import type { Metadata } from "next";
import { Bullet, Bullets, Internal, LegalTable, Step, Steps } from "@/components/marketing/LegalPage";
import { Code, DocsPage, Endpoint, Ic, Label } from "@/components/marketing/DocsPage";
import { API_BASE, API_LIMITS } from "@/components/marketing/docs.config";
import { DOCS_URL } from "@/components/marketing/site";
import { ENTITLEMENT_TABLE } from "@/lib/plans";

export const metadata: Metadata = {
  title: "API reference · Docs · OpenAssets",
  description:
    "The OpenAssets API v1: authenticate with an API key, upload a sheet, crop, export and download a ZIP. Curl examples, rate limits, error codes and plan limits.",
  alternates: { canonical: `${DOCS_URL}/api` },
};

const FREE = ENTITLEMENT_TABLE.free;
const PRO = ENTITLEMENT_TABLE.pro;
const AUTH = `-H "Authorization: Bearer $OPENASSETS_KEY"`;

export default function ApiReferencePage() {
  return (
    <DocsPage
      page="api"
      intro="Run the extraction pipeline from your own code: upload a sheet, crop it, export it and download the ZIP. Version 1 of the API is available on Pro."
      sections={{
        overview: (
          <>
            <p>
              The API is the same pipeline the web app uses, so a sheet uploaded through the API counts against your
              monthly sheets, follows your plan&apos;s limits and shows up in History. All v1 paths start with{" "}
              <Ic>/api/v1</Ic>.
            </p>
            <Code label="API origin">{`${API_BASE}/api/v1`}</Code>
            <p>
              Requests and responses are JSON, except the upload (<Ic>multipart/form-data</Ic>) and the download (a ZIP).
              Call the API from your servers, scripts and CI, never from a web page: a key in a page can be read by
              everyone who opens it.
            </p>
          </>
        ),
        auth: (
          <>
            <p>
              Every request carries an API key in the <Ic>Authorization</Ic> header. Create one in{" "}
              <Internal href="/settings#api-keys">Settings, API keys</Internal>.
            </p>
            <Code label="Authorization header">{`Authorization: Bearer oa_live_…`}</Code>
            <Bullets>
              <Bullet>
                Only API keys work here. Cookies and web session tokens are refused, and an API key does not work on the
                web app&apos;s own API.
              </Bullet>
              <Bullet>
                The full key is shown once, when you create it. OpenAssets stores only a hash of it and the first
                characters, so a lost key cannot be recovered: revoke it and create another.
              </Bullet>
              <Bullet>
                You can hold up to {PRO.apiKeys} active keys. Name each after what uses it, and use one key per
                integration so you can revoke one without touching the rest.
              </Bullet>
              <Bullet>
                Revoking a key takes effect at once. Keys keep working when you sign out or change your password, so
                revoke a key you think has leaked.
              </Bullet>
              <Bullet>
                If your Pro period ends, your keys stay listed but every request answers <Ic>403 PLAN_REQUIRED</Ic> until
                you are on Pro again.
              </Bullet>
            </Bullets>
            <p>To check a key, ask who it belongs to:</p>
            <Code label="Check a key">{`export OPENASSETS_API=${API_BASE}
export OPENASSETS_KEY=oa_live_…

curl "$OPENASSETS_API/api/v1/me" \\
  ${AUTH}`}</Code>
          </>
        ),
        quickstart: (
          <>
            <p>
              Upload a sheet, wait for detection, crop, export, then download. Each step that starts work answers at once
              and the job moves on in the background, so you poll the job between steps.
            </p>
            <Steps>
              <Step n={1}>Upload the sheet. The response holds the job id.</Step>
              <Step n={2}>
                Poll the job until its status is <Ic>detected</Ic>.
              </Step>
              <Step n={3}>
                Crop. Poll until the status is <Ic>cropped</Ic>.
              </Step>
              <Step n={4}>
                Export. Poll until the status is <Ic>ready</Ic>.
              </Step>
              <Step n={5}>Download the ZIP.</Step>
            </Steps>
            <Code label="The whole flow with curl">{`# 1. Upload
curl -X POST "$OPENASSETS_API/api/v1/jobs" \\
  ${AUTH} \\
  -F image=@rpg_pack_v1.png
# → { "data": { "jobId": "7c1e9d52-…", "status": "queued", … } }
JOB=7c1e9d52-…

# 2. Poll until "status" is "detected" (every few seconds)
curl "$OPENASSETS_API/api/v1/jobs/$JOB" \\
  ${AUTH}

# 3. Crop the detected boxes, then poll until "status" is "cropped"
curl -X POST "$OPENASSETS_API/api/v1/jobs/$JOB/crop" \\
  ${AUTH}

# 4. Export at 2x, then poll until "status" is "ready"
curl -X POST "$OPENASSETS_API/api/v1/jobs/$JOB/export" \\
  ${AUTH} \\
  -H "Content-Type: application/json" \\
  -d '{ "scale": 2 }'

# 5. Download the ZIP
curl -o assets.zip "$OPENASSETS_API/api/v1/jobs/$JOB/download" \\
  ${AUTH}`}</Code>
          </>
        ),
        responses: (
          <>
            <p>Every JSON response has the same envelope.</p>
            <Code label="Success envelope">{`{
  "success": true,
  "message": "Job",
  "data": { … }
}`}</Code>
            <Code label="Error envelope">{`{
  "success": false,
  "message": "Job not found.",
  "code": "JOB_NOT_FOUND",
  "details": { … }
}`}</Code>
            <Bullets>
              <Bullet>
                Branch on <Ic>code</Ic> and the HTTP status, never on <Ic>message</Ic>, which is for people and can be
                reworded. <Ic>details</Ic> is present only when there is more to say. See <a className="oa-link" href="#errors">Errors</a>.
              </Bullet>
              <Bullet>
                Server errors (5xx) have a <Ic>message</Ic> and no <Ic>code</Ic>. Retry them after a short wait.
              </Bullet>
              <Bullet>Times are ISO 8601 in UTC. Sizes and positions are in pixels of the original sheet.</Bullet>
              <Bullet>
                Fields may be added to responses at any time, so ignore fields you do not know. Fields are not renamed or
                removed within v1. Unknown fields in request bodies are ignored.
              </Bullet>
            </Bullets>
          </>
        ),
        lifecycle: (
          <>
            <p>
              A job moves through these statuses. Poll <Ic>GET /jobs/{"{jobId}"}</Ic> every two to five seconds.
            </p>
            <LegalTable
              caption="Job statuses"
              columns={["Status", "Meaning", "What to do"]}
              rows={[
                ["uploaded, queued", "The sheet is stored and waiting for detection.", "Wait."],
                ["detecting", "Detection is finding the assets.", "Wait."],
                ["detected", "Boxes are ready.", <>Review <Ic>boxes</Ic>, then call crop.</>],
                ["removing_bg, cropping, naming", "The crop is running: background removal, cutting and AI naming.", "Wait."],
                ["cropped", "The assets are cut out and named.", <>Read <Ic>assets</Ic>, then call export.</>],
                ["finalizing", "The export is running (upscaling).", "Wait."],
                ["ready", "The ZIP can be downloaded.", "Call download."],
                ["failed", <>Something went wrong. <Ic>error</Ic> says what.</>, "Upload the sheet again."],
              ]}
            />
            <p>
              A job is removed about 24 hours after its last change. After that it answers{" "}
              <Ic>404 JOB_NOT_FOUND</Ic> and no longer appears in the job list.
            </p>
          </>
        ),
        me: (
          <>
            <Endpoint method="GET" path="/api/v1/me" />
            <p>
              The key you called with, the plan behind it, this month&apos;s sheets and the limits that apply. Use it to
              check a key.
            </p>
            <Label>Response</Label>
            <Code label="GET /me response">{`{
  "success": true,
  "message": "Account",
  "data": {
    "key": { "id": "66f0…", "name": "CI export", "prefix": "oa_live_a1b2" },
    "plan": "pro",
    "sheets": {
      "used": 3,
      "limit": null,
      "remaining": null,
      "period": "2026-10",
      "resetAt": "2026-11-01T00:00:00.000Z"
    },
    "maxUpscale": 4,
    "rateLimits": {
      "requestsPerMinute": ${API_LIMITS.requestsPerMinute},
      "startsPer15Minutes": ${API_LIMITS.startsPer15Minutes},
      "failedAuthPer15Minutes": ${API_LIMITS.failedAuthPer15Minutes}
    }
  }
}`}</Code>
            <p>
              <Ic>sheets.limit</Ic> is <Ic>null</Ic> when the plan has no limit.
            </p>
          </>
        ),
        upload: (
          <>
            <Endpoint method="POST" path="/api/v1/jobs" />
            <p>
              Upload a sheet and start detection. Send <Ic>multipart/form-data</Ic> with the file in the{" "}
              <Ic>image</Ic> field. The upload uses one of your monthly sheets, and the sheet is given back if the upload
              fails.
            </p>
            <LegalTable
              caption="Upload requirements"
              columns={["Field", "Rule"]}
              rows={[
                [<Ic key="f">image</Ic>, "PNG, JPEG or WebP, up to 20 MB, 64 to 12,000 pixels on each side. Required."],
              ]}
            />
            <Label>Request</Label>
            <Code label="POST /jobs request">{`curl -X POST "$OPENASSETS_API/api/v1/jobs" \\
  ${AUTH} \\
  -F image=@rpg_pack_v1.png`}</Code>
            <Label>Response: 201</Label>
            <Code label="POST /jobs response">{`{
  "success": true,
  "message": "Sheet uploaded. Detection has started.",
  "data": {
    "jobId": "7c1e9d52-4b0e-4c53-9d6f-2a8f0f1c6a10",
    "status": "queued",
    "imageUrl": "https://…/7c1e9d52-….png"
  }
}`}</Code>
            <p>
              Errors: <Ic>400 IMAGE_REQUIRED</Ic>, <Ic>400 INVALID_IMAGE</Ic>, <Ic>413 FILE_TOO_LARGE</Ic>,{" "}
              <Ic>415 UNSUPPORTED_FILE_TYPE</Ic>, <Ic>403 SHEET_LIMIT</Ic>.
            </p>
          </>
        ),
        list: (
          <>
            <Endpoint method="GET" path="/api/v1/jobs" />
            <p>Your recent jobs, newest first, a page at a time. These are the jobs still kept (about 24 hours).</p>
            <LegalTable
              caption="Query parameters"
              columns={["Parameter", "Meaning"]}
              rows={[
                [<Ic key="l">limit</Ic>, "Jobs per page, 1 to 100. Default 50."],
                [<Ic key="c">cursor</Ic>, <>The <Ic>nextCursor</Ic> of the previous page. Omit it for the first page.</>],
              ]}
            />
            <Label>Request</Label>
            <Code label="GET /jobs request">{`curl "$OPENASSETS_API/api/v1/jobs?limit=2" \\
  ${AUTH}`}</Code>
            <Label>Response</Label>
            <Code label="GET /jobs response">{`{
  "success": true,
  "message": "Jobs",
  "data": {
    "jobs": [
      {
        "jobId": "7c1e9d52-…",
        "status": "cropped",
        "fileName": "rpg_pack_v1.png",
        "assetCount": 12,
        "createdAt": "2026-10-30T09:14:02.511Z",
        "imageUrl": "https://…",
        "error": null
      }
    ],
    "nextCursor": "MTc2MTgxMjQ0MjUxMXw3YzFlOWQ1Mi0…"
  }
}`}</Code>
            <p>
              <Ic>nextCursor</Ic> is <Ic>null</Ic> on the last page. <Ic>assetCount</Ic> is the number of detected boxes
              until the crop has produced assets.
            </p>
          </>
        ),
        "get-job": (
          <>
            <Endpoint method="GET" path="/api/v1/jobs/{jobId}" />
            <p>
              A job&apos;s status, the boxes detection found and, once it is cropped, the assets with their names. A job
              that does not exist and a job that belongs to someone else both answer <Ic>404 JOB_NOT_FOUND</Ic>.
            </p>
            <Label>Request</Label>
            <Code label="GET /jobs/{jobId} request">{`curl "$OPENASSETS_API/api/v1/jobs/$JOB" \\
  ${AUTH}`}</Code>
            <Label>Response</Label>
            <Code label="GET /jobs/{jobId} response">{`{
  "success": true,
  "message": "Job",
  "data": {
    "jobId": "7c1e9d52-…",
    "status": "cropped",
    "fileName": "rpg_pack_v1.png",
    "createdAt": "2026-10-30T09:14:02.511Z",
    "image": { "url": "https://…", "width": 2048, "height": 2048 },
    "detection": { "mode": "dark-background", "confidence": 0.93, "warning": null },
    "background": { "kind": "flat", "color": "#f7f6f2" },
    "backgroundRemoval": { "mode": "auto", "method": "server", "reason": null },
    "boxes": [
      { "id": "box_1", "x": 32, "y": 40, "width": 180, "height": 210, "label": "asset_001" }
    ],
    "assets": [
      {
        "id": "box_1",
        "name": "fire_sword",
        "url": "https://…/fire_sword.png",
        "upscaledUrl": null,
        "fileName": null
      }
    ],
    "export": { "scale": null, "namingPattern": null, "ready": false },
    "error": null
  }
}`}</Code>
            <LegalTable
              caption="Job fields"
              columns={["Field", "Meaning"]}
              rows={[
                [<Ic key="a">boxes</Ic>, <>What detection found, in pixels. <Ic>label</Ic> is its placeholder name.</>],
                [
                  <Ic key="bg">background</Ic>,
                  <>
                    What the sheet&apos;s background is: <Ic>kind</Ic> is <Ic>transparent</Ic>, <Ic>flat</Ic> (white, black,
                    a plain colour), <Ic>chroma</Ic> (magenta, green) or <Ic>complex</Ic> (gradient, texture), and{" "}
                    <Ic>color</Ic> is the <Ic>#rrggbb</Ic> value for flat and chroma. <Ic>null</Ic> for sheets detected
                    before this existed.
                  </>,
                ],
                [
                  <Ic key="br">backgroundRemoval</Ic>,
                  <>
                    <Ic>null</Ic> until the crop has run. Then <Ic>mode</Ic> (what was asked), <Ic>method</Ic>{" "}
                    (<Ic>server</Ic>: removed on our server, free; <Ic>ai</Ic>: AI removal;{" "}
                    <Ic>none</Ic>: kept) and <Ic>reason</Ic> when the background was kept.
                  </>,
                ],
                [<Ic key="b">assets</Ic>, <>Empty until the crop finishes. <Ic>id</Ic> is the id of the box it was cut from; <Ic>name</Ic> is the file name used in the ZIP.</>],
                [<Ic key="c">assets[].upscaledUrl</Ic>, "Set per asset once the export has upscaled it."],
                [<Ic key="g">assets[].fileName</Ic>, <>The file name (with <Ic>.png</Ic>) the export gave the asset. <Ic>null</Ic> until the export has started.</>],
                [<Ic key="h">export.namingPattern</Ic>, "The naming pattern the export follows, once it has started."],
                [<Ic key="d">export.scale</Ic>, <>The upscale factor of the export once it has started: <Ic>2</Ic> or <Ic>4</Ic>, or <Ic>1</Ic> when it skipped upscaling.</>],
                [<Ic key="e">export.ready</Ic>, <><Ic>true</Ic> when the ZIP can be downloaded.</>],
                [<Ic key="f">error</Ic>, <>Why the job failed, when its status is <Ic>failed</Ic>.</>],
              ]}
            />
          </>
        ),
        crop: (
          <>
            <Endpoint method="POST" path="/api/v1/jobs/{jobId}/crop" />
            <p>
              Cut the assets out and name them. This removes backgrounds and asks an AI model for names, and like the
              web app it leaves a private draft collection in My collections. The job must be <Ic>detected</Ic>. Send{" "}
              <Ic>boxes</Ic> to correct what detection found, or nothing to crop the detected boxes as they are.
            </p>
            <LegalTable
              caption="Body"
              columns={["Field", "Meaning"]}
              rows={[
                [
                  <Ic key="b">boxes</Ic>,
                  <>
                    Optional. 1 to 1,000 objects <Ic>{"{ id, x, y, width, height, label? }"}</Ic> in pixels of the
                    original sheet. <Ic>id</Ic> is a string you choose. It replaces the detected boxes.
                  </>,
                ],
                [
                  <Ic key="e">removeEnclosedBackground</Ic>,
                  <>
                    Optional boolean, default <Ic>false</Ic>. <Ic>true</Ic> also removes background inside an asset,
                    such as the hole of a ring or a letter. It applies whenever the server removes the background
                    itself (see <Ic>backgroundRemoval</Ic>), on any storage provider, and it removes every pocket
                    that matches the background colour. The AI cut-out ignores it. Other values answer{" "}
                    <Ic>400 VALIDATION_ERROR</Ic>.
                  </>,
                ],
                [
                  <Ic key="r">backgroundRemoval</Ic>,
                  <>
                    Optional, default <Ic>&quot;auto&quot;</Ic>. <Ic>&quot;auto&quot;</Ic> removes a flat or
                    chroma-key background on the server for free and uses AI removal only for a gradient
                    or texture. <Ic>&quot;flat&quot;</Ic> removes a flat background on the server and keeps the
                    background of any other sheet. <Ic>&quot;ai&quot;</Ic> always uses AI removal (not
                    available on local storage, where the background is kept). <Ic>&quot;none&quot;</Ic> keeps the
                    background. A transparent sheet needs nothing in any mode. Any other value answers{" "}
                    <Ic>400 VALIDATION_ERROR</Ic>. The job reports <Ic>background</Ic> (<Ic>kind</Ic>{" "}
                    <Ic>transparent</Ic>, <Ic>flat</Ic>, <Ic>chroma</Ic> or <Ic>complex</Ic>, and <Ic>color</Ic>) after
                    detection, and <Ic>backgroundRemoval.method</Ic> (<Ic>server</Ic>, <Ic>ai</Ic> or <Ic>none</Ic>) with a{" "}
                    <Ic>reason</Ic> when the background was kept, after the crop.
                  </>,
                ],
              ]}
            />
            <Label>Request</Label>
            <Code label="POST /jobs/{jobId}/crop request">{`curl -X POST "$OPENASSETS_API/api/v1/jobs/$JOB/crop" \\
  ${AUTH} \\
  -H "Content-Type: application/json" \\
  -d '{ "boxes": [ { "id": "box_1", "x": 32, "y": 40, "width": 180, "height": 210 } ] }'`}</Code>
            <Label>Response: 201</Label>
            <Code label="POST /jobs/{jobId}/crop response">{`{ "success": true, "message": "Crop started", "data": { "jobId": "7c1e9d52-…" } }`}</Code>
            <p>
              Errors: <Ic>404 JOB_NOT_FOUND</Ic>, <Ic>409 INVALID_JOB_STATE</Ic> (the job is not <Ic>detected</Ic>; the
              status is in <Ic>details</Ic>), <Ic>400 VALIDATION_ERROR</Ic>.
            </p>
          </>
        ),
        export: (
          <>
            <Endpoint method="POST" path="/api/v1/jobs/{jobId}/export" />
            <p>
              Start the export: choose assets, rename them, and upscale. The job must be <Ic>cropped</Ic>. With no body
              it exports every asset at 2×.
            </p>
            <LegalTable
              caption="Body"
              columns={["Field", "Meaning"]}
              rows={[
                [<Ic key="s">selectedIds</Ic>, <>Optional. Asset ids to export. Default: all. Ids that match no asset are ignored.</>],
                [<Ic key="n">names</Ic>, <>Optional. Rename assets for this export: <Ic>{`{ "box_1": "big_sword" }`}</Ic>. Names are used as file names in the ZIP.</>],
                [<Ic key="c">scale</Ic>, <><Ic>2</Ic> or <Ic>4</Ic>. Default <Ic>2</Ic>. The factor is checked against your plan&apos;s upscale limit.</>],
                [<Ic key="u">upscale</Ic>, <><Ic>false</Ic> exports the crops as they are, with no AI upscaling. Default <Ic>true</Ic>.</>],
                [
                  <Ic key="p">namingPattern</Ic>,
                  <>
                    How the files are named, for example <Ic>{"{sheet}_{index:03}_{name}"}</Ic>. Default: the pattern
                    saved in Settings, Export, otherwise <Ic>{"{name}"}</Ic>. See <a className="oa-link" href="#naming">Naming patterns</a>.
                  </>,
                ],
              ]}
            />
            <Label>Request</Label>
            <Code label="POST /jobs/{jobId}/export request">{`curl -X POST "$OPENASSETS_API/api/v1/jobs/$JOB/export" \\
  ${AUTH} \\
  -H "Content-Type: application/json" \\
  -d '{ "selectedIds": ["box_1"], "names": { "box_1": "big_sword" }, "scale": 4, "namingPattern": "{name}@{scale}x" }'`}</Code>
            <Label>Response: 201</Label>
            <Code label="POST /jobs/{jobId}/export response">{`{
  "success": true,
  "message": "Export started",
  "data": {
    "jobId": "7c1e9d52-…",
    "namingPattern": "{name}@{scale}x",
    "scale": 4,
    "files": [
      { "id": "box_1", "name": "big_sword", "fileName": "big_sword@4x.png" }
    ]
  }
}`}</Code>
            <p>
              <Ic>files</Ic> lists the file names the export will use, one per selected asset: <Ic>name</Ic> is the
              asset&apos;s name and <Ic>fileName</Ic> what it is called in the ZIP. <Ic>scale</Ic> is the upscale factor
              (<Ic>1</Ic> when <Ic>upscale</Ic> is <Ic>false</Ic>). The same names appear as <Ic>assets[].fileName</Ic>{" "}
              on the job once the export is under way.
            </p>
            <p>
              Errors: <Ic>404 JOB_NOT_FOUND</Ic>, <Ic>409 INVALID_JOB_STATE</Ic> (the job is not <Ic>cropped</Ic>),{" "}
              <Ic>400 VALIDATION_ERROR</Ic>, <Ic>400 INVALID_PATTERN</Ic> (the naming pattern is not valid),{" "}
              <Ic>400 BAD_REQUEST</Ic> (no selected id matches an asset), <Ic>403 PLAN_LIMIT</Ic> (the scale is above
              your plan&apos;s limit).
            </p>
          </>
        ),
        naming: (
          <>
            <p>
              A naming pattern is literal text with tokens in braces. It sets the name of each file in the export. The
              default, <Ic>{"{name}"}</Ic>, is the asset&apos;s name.
            </p>
            <LegalTable
              caption="Naming pattern tokens"
              columns={["Token", "Is", "Example"]}
              rows={[
                [<Ic key="1">{"{name}"}</Ic>, "The asset name", "fire_sword"],
                [<Ic key="2">{"{index}"}</Ic>, "Position in this export, from 1", "1"],
                [<Ic key="3">{"{index:03}"}</Ic>, "The same, zero-padded to 1 to 8 digits", "001"],
                [<Ic key="4">{"{sheet}"}</Ic>, "The uploaded file name without its extension", "rpg_pack_v1"],
                [<><Ic key="5">{"{w}"}</Ic> <Ic key="6">{"{h}"}</Ic></>, "Width and height in pixels of the exported image, after upscaling", "128, 96"],
                [<Ic key="7">{"{scale}"}</Ic>, "The upscale factor: 1 when not upscaled, else 2 or 4", "2"],
                [<Ic key="8">{"{date}"}</Ic>, "The export date in UTC", "2026-10-30"],
              ]}
            />
            <Bullets>
              <Bullet>
                1 to 100 characters, and it must contain <Ic>{"{name}"}</Ic> or <Ic>{"{index}"}</Ic> so names differ.
                Unknown tokens, unmatched braces and slashes are errors (<Ic>400 INVALID_PATTERN</Ic>, with{" "}
                <Ic>details.issues</Ic>).
              </Bullet>
              <Bullet>
                Names are cleaned for use as files: letters, digits, <Ic>-</Ic>, <Ic>_</Ic>, <Ic>.</Ic> and{" "}
                <Ic>@</Ic> are kept and anything else becomes <Ic>_</Ic>. Names that still collide get{" "}
                <Ic>_2</Ic>, <Ic>_3</Ic>.
              </Bullet>
              <Bullet>
                Custom patterns are part of Pro, like the API itself. Without a <Ic>namingPattern</Ic> in the request,
                the default saved in Settings, Export applies.
              </Bullet>
            </Bullets>
            <Code label="Naming pattern examples">{`{name}                       fire_sword.png
{sheet}_{index:03}_{name}    rpg_pack_v1_001_fire_sword.png
{name}@{scale}x              fire_sword@2x.png
icon-{index}-{w}x{h}         icon-1-128x96.png`}</Code>
          </>
        ),
        download: (
          <>
            <Endpoint method="GET" path="/api/v1/jobs/{jobId}/download" />
            <p>
              The ZIP of the exported PNGs, built when you ask for it, with a <Ic>metadata.json</Ic> next to the
              images. It holds the assets you selected, upscaled if you asked for that, each named as the export&apos;s
              naming pattern says (<Ic>assets[].fileName</Ic>). The job must be <Ic>ready</Ic>.
            </p>
            <Label>Request</Label>
            <Code label="GET /jobs/{jobId}/download request">{`curl -o assets.zip "$OPENASSETS_API/api/v1/jobs/$JOB/download" \\
  ${AUTH}`}</Code>
            <p>
              The response is <Ic>200</Ic> with <Ic>Content-Type: application/zip</Ic>. Errors:{" "}
              <Ic>404 JOB_NOT_FOUND</Ic>, <Ic>409 JOB_NOT_READY</Ic>, <Ic>502 EXPORT_FETCH_FAILED</Ic> (the stored images
              could not be fetched: try again).
            </p>
          </>
        ),
        "rate-limits": (
          <>
            <LegalTable
              caption="Rate limits"
              columns={["Limit", "Applies to", "Window"]}
              rows={[
                [String(API_LIMITS.requestsPerMinute), "Every request, per API key", "1 minute"],
                [
                  String(API_LIMITS.startsPer15Minutes),
                  <>Requests that start work (<Ic>POST /jobs</Ic>, <Ic>/crop</Ic>, <Ic>/export</Ic>), per API key. These count whether or not they succeed.</>,
                  "15 minutes",
                ],
                [
                  String(API_LIMITS.failedAuthPer15Minutes),
                  <>Requests answered <Ic>401</Ic> because of a bad key, per IP address</>,
                  "15 minutes",
                ],
              ]}
            />
            <Bullets>
              <Bullet>
                Limits follow the key, not the address: two keys on one server are counted separately.
              </Bullet>
              <Bullet>
                Responses carry <Ic>RateLimit-Limit</Ic>, <Ic>RateLimit-Remaining</Ic> and <Ic>RateLimit-Reset</Ic> (seconds
                until the minute limit resets).
              </Bullet>
              <Bullet>
                Past a limit you get <Ic>429 RATE_LIMITED</Ic> with a <Ic>Retry-After</Ic> header in seconds. Wait that
                long, then retry. Counts are kept by each API server, so treat the numbers as ceilings.
              </Bullet>
            </Bullets>
            <Code label="A rate-limited response">{`HTTP/1.1 429 Too Many Requests
Retry-After: 23

{
  "success": false,
  "message": "Rate limit reached: ${API_LIMITS.requestsPerMinute} requests a minute per API key. Retry after the time in Retry-After.",
  "code": "RATE_LIMITED",
  "details": { "retryAfterSeconds": 23 }
}`}</Code>
          </>
        ),
        errors: (
          <LegalTable
            caption="Error codes"
            columns={["Status", "Code", "Meaning"]}
            rows={[
              ["401", <Ic key="1">API_KEY_MISSING</Ic>, "No Authorization header, or not a Bearer one."],
              ["401", <Ic key="2">API_KEY_INVALID</Ic>, "Not a key we issued. A web session token is not one."],
              ["401", <Ic key="3">API_KEY_REVOKED</Ic>, "The key was revoked in Settings. Create a new one."],
              ["403", <Ic key="4">PLAN_REQUIRED</Ic>, "The account is no longer on Pro. Keys work again when it is."],
              ["403", <Ic key="5">PLAN_LIMIT</Ic>, <>A plan limit would be exceeded, for example <Ic>scale</Ic> 4 above the plan&apos;s upscale limit. <Ic>details</Ic> has the limit.</>],
              ["403", <Ic key="6">SHEET_LIMIT</Ic>, <>The monthly sheet allowance is used up. <Ic>details.resetAt</Ic> says when it resets. Pro has no sheet limit.</>],
              ["404", <Ic key="7">JOB_NOT_FOUND</Ic>, "No such job, it belongs to someone else, or it expired."],
              ["404", <Ic key="8">NOT_FOUND</Ic>, "No such endpoint."],
              ["409", <Ic key="9">INVALID_JOB_STATE</Ic>, <>The job is not in the state this call needs. <Ic>details</Ic> has the current and the expected status.</>],
              ["409", <Ic key="10">JOB_NOT_READY</Ic>, <>The export has not finished. <Ic>details.status</Ic> has the current status.</>],
              ["400", <Ic key="11">VALIDATION_ERROR</Ic>, <>The body failed validation. <Ic>details.issues</Ic> lists what was wrong.</>],
              ["400", <Ic key="12">IMAGE_REQUIRED</Ic>, <>No file in the <Ic>image</Ic> field.</>],
              ["400", <Ic key="13">INVALID_IMAGE</Ic>, "The image is not PNG, JPEG or WebP, or is outside 64 to 12,000 pixels."],
              ["400", <Ic key="22">INVALID_PATTERN</Ic>, <>The naming pattern is not valid. <Ic>details.issues</Ic> lists the problems.</>],
              ["400", <Ic key="14">INVALID_JSON</Ic>, "The body is not valid JSON."],
              ["400", <Ic key="15">INVALID_UPLOAD</Ic>, "The multipart request is malformed or sends the file in the wrong field."],
              ["400", <Ic key="16">BAD_REQUEST</Ic>, "Anything else wrong with the request, such as a bad query parameter."],
              ["413", <Ic key="17">FILE_TOO_LARGE</Ic>, "The image is over 20 MB."],
              ["413", <Ic key="18">PAYLOAD_TOO_LARGE</Ic>, "The JSON body is over 100 KB."],
              ["415", <Ic key="19">UNSUPPORTED_FILE_TYPE</Ic>, "The file is not an image."],
              ["429", <Ic key="20">RATE_LIMITED</Ic>, <>Too many requests. See <a className="oa-link" href="#rate-limits">Rate limits</a>.</>],
              ["502", <Ic key="21">EXPORT_FETCH_FAILED</Ic>, "The stored images could not be fetched to build the ZIP. Try again."],
            ]}
          />
        ),
        "plan-limits": (
          <>
            <LegalTable
              caption="Plan limits that apply to the API"
              columns={["Limit", "Free", "Pro"]}
              rows={[
                ["API access", "None", `Up to ${PRO.apiKeys} keys`],
                ["Sheets per month", String(FREE.sheetsPerMonth), PRO.sheetsPerMonth === null ? "Unlimited" : String(PRO.sheetsPerMonth)],
                ["Export upscale (scale)", `Up to ${FREE.maxUpscale}×`, `Up to ${PRO.maxUpscale}×`],
              ]}
            />
            <Bullets>
              <Bullet>
                Free accounts cannot create API keys: creating one answers <Ic>403 PLAN_REQUIRED</Ic>. A sixth active key
                on Pro answers <Ic>403 PLAN_LIMIT</Ic>; revoke one to make room.
              </Bullet>
              <Bullet>
                Each upload counts as a sheet, the same count the web app uses, shown in <Ic>sheets</Ic> on{" "}
                <Ic>GET /me</Ic>.
              </Bullet>
              <Bullet>
                Other limits: 20 MB per image, 64 to 12,000 pixels per side, 100 KB per JSON body, 1,000 boxes per crop.
              </Bullet>
              <Bullet>
                If your Pro period ends, requests with your keys answer <Ic>403 PLAN_REQUIRED</Ic>. Jobs you already
                started are not lost, but you cannot reach them through the API until you are on Pro again.
              </Bullet>
            </Bullets>
            <p>
              See <Internal href="/pricing">Pricing</Internal> for the plans.
            </p>
          </>
        ),
      }}
    />
  );
}
