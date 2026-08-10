"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  WHATSAPP_LEAD_HEADERS,
  extractIndonesianWhatsAppNumber,
  inboundLeadFrom,
  normalizeIndonesianWhatsAppNumber,
  normalizeUsername,
  prepareLeadUpsert,
  sheetRows
} = require("../src/whatsappLead");

const ROOT = path.resolve(__dirname, "..");

function importWorkflow(fileName) {
  return JSON.parse(
    fs.readFileSync(path.join(ROOT, "n8n", "imports", fileName), "utf8")
  );
}

test("normalizes common Indonesian WhatsApp formats to +62", () => {
  const cases = [
    ["082210358121", "+6282210358121"],
    ["6282210358121", "+6282210358121"],
    ["+6282210358121", "+6282210358121"],
    ["08 22 1035 8121", "+6282210358121"],
    ["+62 (822) 1035-8121", "+6282210358121"],
    ["０８２２１０３５８１２１", "+6282210358121"]
  ];
  for (const [input, expected] of cases) {
    assert.equal(normalizeIndonesianWhatsAppNumber(input), expected);
    assert.equal(extractIndonesianWhatsAppNumber(input), expected);
  }
});

test("extracts the first valid phone from mixed reply text", () => {
  assert.equal(
    extractIndonesianWhatsAppNumber("boleh kak, WA aku 0822-1035-8121 ya 🙏"),
    "+6282210358121"
  );
  assert.equal(
    extractIndonesianWhatsAppNumber(
      "utama 0812 8055 074, cadangan +62 823 2373 4300"
    ),
    "+628128055074"
  );
});

test("rejects short, non-mobile, percentage, and oversized numbers", () => {
  for (const input of [
    "",
    "komisi 10%",
    "0822",
    "021 555 1234",
    "7857891324986241124",
    "+62822103581212345",
    "order 202607250001"
  ]) {
    assert.equal(extractIndonesianWhatsAppNumber(input), "");
  }
});

test("reads a TikTok Shop notification and preserves its original timestamp", () => {
  const lead = inboundLeadFrom({
    message_received_at: "2026-07-25T04:28:12.000Z",
    body: {
      type: 33,
      data: {
        content: JSON.stringify({ content: "boleh k 082210358121" }),
        conversation_id: "conv-1",
        message_id: "msg-1",
        sender: { sender_im_user_id: "sender-1" }
      }
    }
  });

  assert.deepEqual(lead, {
    affiliate_id: "sender-1",
    username: "",
    conversation_id: "conv-1",
    message_id: "msg-1",
    inbound_text: "boleh k 082210358121",
    whatsapp_number: "+6282210358121",
    captured_at: "2026-07-25T04:28:12.000Z"
  });
});

test("backfill timestamp override preserves historical capture time", () => {
  const lead = inboundLeadFrom({
    message_received_at: "2026-07-25T06:00:00.000Z",
    body: {
      backfill_original_received_at: "2026-07-22T08:15:00.000Z",
      data: {
        content: JSON.stringify({ content: "WA 082210358121" }),
        conversation_id: "conv-old"
      }
    }
  });
  assert.equal(lead.captured_at, "2026-07-22T08:15:00.000Z");
});

test("normalizes TikTok usernames without changing their spelling", () => {
  assert.equal(normalizeUsername("@Creator.Name"), "Creator.Name");
  assert.equal(normalizeUsername("  @creator_01  "), "creator_01");
});

test("validates the WhatsApp Leads header", () => {
  assert.deepEqual(WHATSAPP_LEAD_HEADERS, [
    "username",
    "whatsapp_number",
    "conversation_id",
    "captured_at",
    "reply_1",
    "reply_2",
    "reply_3"
  ]);
  assert.deepEqual(
    sheetRows([
      [...WHATSAPP_LEAD_HEADERS],
      ["creator", "+6282210358121", "conv-1", "2026-07-25T01:00:00.000Z"]
    ]),
    [
      {
        row_number: 2,
        username: "creator",
        whatsapp_number: "+6282210358121",
        conversation_id: "conv-1",
        captured_at: "2026-07-25T01:00:00.000Z",
        reply_1: "",
        reply_2: "",
        reply_3: ""
      }
    ]
  );
  assert.throws(
    () => sheetRows([["phone", "username"]]),
    /header mismatch/
  );
});

test("appends a new lead and allows a blank username", () => {
  const result = prepareLeadUpsert(
    {
      username: "",
      whatsapp_number: "+6282210358121",
      conversation_id: "conv-1",
      captured_at: "2026-07-25T01:00:00.000Z"
    },
    [[...WHATSAPP_LEAD_HEADERS]]
  );

  assert.equal(result.action, "append");
  assert.deepEqual(result.row_values, [
    "",
    "+6282210358121",
    "conv-1",
    "2026-07-25T01:00:00.000Z",
    "",
    "",
    ""
  ]);
});

test("updates the same conversation with a newer number and username", () => {
  const result = prepareLeadUpsert(
    {
      username: "@creator",
      whatsapp_number: "082323734300",
      conversation_id: "conv-1",
      captured_at: "2026-07-25T02:00:00.000Z"
    },
    [
      [...WHATSAPP_LEAD_HEADERS],
      ["", "+6282210358121", "conv-1", "2026-07-25T01:00:00.000Z"]
    ]
  );

  assert.equal(result.action, "update");
  assert.equal(result.row_number, 2);
  assert.deepEqual(result.row_values, [
    "creator",
    "+6282323734300",
    "conv-1",
    "2026-07-25T02:00:00.000Z",
    "",
    "",
    ""
  ]);
});

test("stores three recent replies oldest to newest", () => {
  const result = prepareLeadUpsert(
    {
      username: "creator",
      whatsapp_number: "+6282210358121",
      conversation_id: "conv-1",
      captured_at: "2026-07-25T02:00:00.000Z",
      recent_replies: ["first", "second", "third", "fourth"]
    },
    [[...WHATSAPP_LEAD_HEADERS]]
  );

  assert.equal(result.action, "append");
  assert.deepEqual(result.row_values.slice(4), ["second", "third", "fourth"]);
});

test("older backfill enriches replies without rolling back lead fields", () => {
  const result = prepareLeadUpsert(
    {
      username: "old-name",
      whatsapp_number: "+6282323734300",
      conversation_id: "conv-1",
      captured_at: "2026-07-25T01:00:00.000Z",
      recent_replies: ["hello", "send here", "0822 1035 8121"]
    },
    [
      [...WHATSAPP_LEAD_HEADERS],
      [
        "creator",
        "+6282210358121",
        "conv-1",
        "2026-07-25T02:00:00.000Z",
        "",
        "",
        ""
      ]
    ]
  );

  assert.equal(result.action, "update");
  assert.deepEqual(result.row_values, [
    "creator",
    "+6282210358121",
    "conv-1",
    "2026-07-25T02:00:00.000Z",
    "hello",
    "send here",
    "0822 1035 8121"
  ]);
});

test("does not rewrite duplicates or let older messages overwrite a row", () => {
  const values = [
    [...WHATSAPP_LEAD_HEADERS],
    ["creator", "+6282210358121", "conv-1", "2026-07-25T02:00:00.000Z"]
  ];
  assert.deepEqual(
    {
      action: prepareLeadUpsert(
        {
          username: "creator",
          whatsapp_number: "+6282210358121",
          conversation_id: "conv-1",
          captured_at: "2026-07-25T02:00:00.000Z"
        },
        values
      ).action,
      reason: prepareLeadUpsert(
        {
          username: "creator",
          whatsapp_number: "+6282210358121",
          conversation_id: "conv-1",
          captured_at: "2026-07-25T02:00:00.000Z"
        },
        values
      ).reason
    },
    { action: "no_write", reason: "duplicate_delivery" }
  );
  const older = prepareLeadUpsert(
    {
      username: "creator",
      whatsapp_number: "+6282323734300",
      conversation_id: "conv-1",
      captured_at: "2026-07-25T01:00:00.000Z"
    },
    values
  );
  assert.equal(older.action, "no_write");
  assert.equal(older.reason, "older_than_existing");
});

test("standalone n8n extractor handles phone-only and mixed replies", () => {
  const code = fs.readFileSync(
    path.join(ROOT, "n8n", "code", "extract-whatsapp-lead.js"),
    "utf8"
  );
  const run = new Function("$input", code);
  const output = run({
    all: () => [
      {
        json: {
          body: {
            data: {
              content: JSON.stringify({ content: "082323734300" }),
              conversation_id: "conv-1",
              create_time: "1784952000",
              message_id: "msg-1",
              sender: { sender_im_user_id: "sender-1" }
            }
          }
        }
      },
      {
        json: {
          body: {
            data: {
              content: JSON.stringify({ content: "baik kak" }),
              conversation_id: "conv-2"
            }
          }
        }
      }
    ]
  });

  assert.equal(output[0].json.whatsapp_number, "+6282323734300");
  assert.equal(output[0].json.has_valid_phone, true);
  assert.equal(output[0].json.action, "capture_whatsapp_lead");
  assert.equal(output[1].json.has_valid_phone, false);
  assert.equal(output[1].json.action, "no_write");
});

test("username resolver keeps a supplied username or uses conversation lookup", () => {
  const code = fs.readFileSync(
    path.join(ROOT, "n8n", "code", "resolve-username-from-conversations.js"),
    "utf8"
  );
  const run = new Function("$", "$json", code);
  const source = {
    username: "",
    affiliate_id: "sender-1",
    conversation_id: "conv-1",
    whatsapp_number: "+6282210358121"
  };
  const output = run(
    () => ({ first: () => ({ json: source }) }),
    {
      data: {
        conversations: [
          {
            id: "conv-1",
            username: "@Creator.Name",
            creator_im_id: "sender-1"
          }
        ]
      }
    }
  );
  assert.equal(output[0].json.username, "Creator.Name");
  assert.equal(output[0].json.conversation_lookup_matched, true);
});

test("generated workflows cannot send TikTok messages or touch Drive", () => {
  const processor = importWorkflow("affiliate-whatsapp-lead-capture.json");
  const router = importWorkflow("affiliate-message-router.json");
  assert.equal(processor.id, "AfDriveReady2026");
  assert.equal(processor.name, "Affiliate WhatsApp Lead Capture");
  assert.equal(processor.active, true);
  assert.equal(processor.settings.saveDataSuccessExecution, "none");
  assert.equal(processor.settings.saveDataErrorExecution, "all");
  assert.equal(processor.settings.callerIds, "AfDriveRouter2026");
  assert.ok(processor.nodes.length < 30);
  assert.equal(router.settings.saveDataSuccessExecution, "none");

  const serialized = JSON.stringify([router, processor]);
  assert.doesNotMatch(serialized, /googleDriveOAuth2Api/);
  assert.doesNotMatch(serialized, /Search Clips Folders/);
  assert.doesNotMatch(serialized, /Rename Drive Folder/);
  assert.doesNotMatch(serialized, /Send Drive Link TikTok/);
  assert.doesNotMatch(serialized, /send_explanation_template/);
  assert.doesNotMatch(
    serialized,
    /affiliate_seller\\\/.*conversations\\\/.*messages/
  );
  const optInHandoff = processor.nodes.find(
    (node) => node.name === "Dispatch WhatsApp Opt-in"
  );
  assert.ok(optInHandoff);
  assert.equal(optInHandoff.parameters.workflowId.value, "AffWaOptIn2026");
  assert.equal(optInHandoff.parameters.workflowId.mode, "list");
  assert.equal(
    optInHandoff.parameters.options.waitForSubWorkflow,
    false
  );

  const lookup = processor.nodes.find(
    (node) => node.name === "Fetch Conversation List"
  );
  assert.equal(lookup.parameters.method, "GET");
  assert.equal(lookup.retryOnFail, true);
  assert.equal(lookup.maxTries, 3);
});

test("router preserves the production webhook and calls the existing processor ID", () => {
  const router = importWorkflow("affiliate-message-router.json");
  const webhook = router.nodes.find(
    (node) => node.name === "Affiliate Message Webhook"
  );
  const execute = router.nodes.find(
    (node) => node.name === "Process Real Unread Message"
  );
  assert.equal(router.id, "AfDriveRouter2026");
  assert.equal(webhook.parameters.path, "tiktok-message");
  assert.equal(execute.parameters.workflowId.value, "AfDriveReady2026");
  assert.equal(execute.parameters.workflowId.mode, "list");
  assert.equal(execute.parameters.options.waitForSubWorkflow, false);
  assert.equal(
    router.connections["Filter Recent Unread Message"].main[0][0].node,
    "Process Real Unread Message"
  );
});

test("setup workflow creates and verifies the exact lead header", () => {
  const setup = importWorkflow("affiliate-whatsapp-leads-setup.json");
  const serialized = JSON.stringify(setup);
  assert.equal(setup.active, false);
  assert.match(serialized, /WhatsApp Leads/);
  assert.match(
    serialized,
    /username.*whatsapp_number.*conversation_id.*captured_at/
  );
  const historicalRead = setup.nodes.find(
    (node) => node.name === "Read Historical Tracker For Verification"
  );
  assert.ok(historicalRead);
  assert.equal(historicalRead.parameters.method, undefined);
  assert.match(historicalRead.parameters.url, /Affiliate%20Assignments/);
});

test("Dami template contains the supplied nickname placeholder and no n8n send", () => {
  const template = fs.readFileSync(
    path.join(ROOT, "templates", "messages.md"),
    "utf8"
  );
  assert.match(template, /Halo kak \{\{nickName\}\} 👋/);
  assert.match(template, /cantumin nomer WhatsApp kaka ya/);
  assert.match(template, /n8n does not send an automatic TikTok reply/);
});
