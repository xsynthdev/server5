import express from "express";
import crypto from "crypto";

const app = express();

app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf.toString();
  }
}));

// SECRETS
const RETELL_SECRET = "key_7f7068e4cd60b69325a912db425a";

// FIELD KEYS
const FIELDS = {
  interestType: "88ced999624f14c97af4818f281c1333ac37ea92",
  investmentExperience: "1d838bd362e9f5823f696dfbde3619b2a0126c96",
  amountRange: "b71bc927c880fba88d767a0dbcd62c3c1a0e83ed",
  timeline: "424a59c170145feebf0ef97afb2ae986a81b721b",

  qualified: "3a6cea6351a1a7508896ee1b3a3c1131e8503194",
  qualificationLevel: "89540e5a0d6a0d9bd128fdaf2a716120d94d5f70",
  readyToDeposit: "3f952f2f87a6478e6b5a0f9fc664839c7fdd6bb4",

  appointmentRequested: "6aeb0cf3cb72eab9c21a38f6fd12a2a7f0bca8d5",
  preferredCallbackTime: "f507876fe12c5d4ff8096b2c881ad6224d92e933",
  wantsBrochure: "ce773b9181a38ae95cfd3ad74a9f6ef3f0618cad",
  wantsContract: "826ff48f3a195f2514d8277719bc3fd4d4e1d9bd",
  wantsProposal: "08e7b47a5e37bf63d9e6b0df85bddeffb2717101",

  callSummary: "6fcca7fbe2abb5ec012b61fb0861d375cc2ee520",
  mainObjection: "0663fb64b25a0b2bce0217e81599ddec6c047f6f",
  nextAction: "f189646486bd1a1aceaefca88fd0c531038d8a28",

  retellCallId: "bdca5bf02c2364d1695c167fbb6830f2a1ff4c78",
};

// VERIFY RETELL SIGNATURE
function verifySignature(rawBody, signature) {
  if (!rawBody || !signature) {
    return false;
  }

  const expected = crypto
    .createHmac("sha256", RETELL_SECRET)
    .update(rawBody)
    .digest("hex");

  return signature === expected;
}

// PIPEDRIVE REQUEST
async function pdRequest(url, method, body) {
  const res = await fetch(`https://api.pipedrive.com/v1${url}?api_token=5c84f2d40d96dfc8035ed24f2531bc2480e4121e`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined
  });

  const data = await res.json();

  if (!res.ok) {
    console.error("Pipedrive error:", data);
    throw new Error(`Pipedrive request failed: ${res.status}`);
  }

  return data;
}

// FIND OR CREATE PERSON
async function upsertPerson(data) {
  let personId = null;

  if (data.email) {
    const search = await pdRequest(
      `/persons/search?term=${encodeURIComponent(data.email)}&fields=email`,
      "GET"
    );
    personId = search?.data?.items?.[0]?.item?.id;
  }

  if (!personId && data.phone) {
    const search = await pdRequest(
      `/persons/search?term=${encodeURIComponent(data.phone)}&fields=phone`,
      "GET"
    );
    personId = search?.data?.items?.[0]?.item?.id;
  }

  const payload = {
    name: data.name || "Unknown Lead",
    email: data.email ? [{ value: data.email, primary: true }] : undefined,
    phone: data.phone ? [{ value: data.phone, primary: true }] : undefined,
  };

  if (personId) {
    await pdRequest(`/persons/${personId}`, "PUT", payload);
    return personId;
  }

  const created = await pdRequest(`/persons`, "POST", payload);
  return created?.data?.id;
}

// CREATE LEAD
async function createLead(personId, analysis, call) {
  const body = {
    title: `Platinum Asset Lead - ${analysis.lead_name || call.from_number || "Unknown"}`,
    person_id: personId,

    [FIELDS.interestType]: analysis.interest_type || "",
    [FIELDS.investmentExperience]: analysis.investment_experience || "",
    [FIELDS.amountRange]: analysis.amount_range || "",
    [FIELDS.timeline]: analysis.timeline || "",
    [FIELDS.qualified]: Boolean(analysis.qualified),
    [FIELDS.qualificationLevel]: analysis.qualification_level || "",
    [FIELDS.readyToDeposit]: Boolean(analysis.ready_to_deposit),

    [FIELDS.appointmentRequested]: Boolean(analysis.appointment_requested),
    [FIELDS.preferredCallbackTime]: analysis.preferred_callback_time || "",
    [FIELDS.wantsBrochure]: Boolean(analysis.wants_brochure),
    [FIELDS.wantsContract]: Boolean(analysis.wants_contract),
    [FIELDS.wantsProposal]: Boolean(analysis.wants_proposal),

    [FIELDS.callSummary]: analysis.call_summary || "",
    [FIELDS.mainObjection]: analysis.main_objection || "",
    [FIELDS.nextAction]: analysis.recommended_next_action || "",

    [FIELDS.retellCallId]: call.call_id || "",
  };

  const res = await pdRequest(`/leads`, "POST", body);
  return res?.data?.id;
}

// CREATE NOTE
async function createNote(personId, leadId, analysis, call) {
  const content = `
<b>Lead Details</b><br/>
<b>Name:</b> ${analysis.lead_name || "N/A"}<br/>
<b>Email:</b> ${analysis.email || "N/A"}<br/>
<b>Phone:</b> ${analysis.phone_number || call.from_number || "N/A"}<br/><br/>

<b>Qualification</b><br/>
<b>Interest:</b> ${analysis.interest_type || "N/A"}<br/>
<b>Experience:</b> ${analysis.investment_experience || "N/A"}<br/>
<b>Amount:</b> ${analysis.amount_range || "N/A"}<br/>
<b>Timeline:</b> ${analysis.timeline || "N/A"}<br/>
<b>Qualified:</b> ${analysis.qualified ? "Yes" : "No"}<br/>
<b>Level:</b> ${analysis.qualification_level || "N/A"}<br/>
<b>Ready To Deposit:</b> ${analysis.ready_to_deposit ? "Yes" : "No"}<br/><br/>

<b>Intent / Follow Up</b><br/>
<b>Appointment Requested:</b> ${analysis.appointment_requested ? "Yes" : "No"}<br/>
<b>Preferred Callback Time:</b> ${analysis.preferred_callback_time || "N/A"}<br/>
<b>Wants Brochure:</b> ${analysis.wants_brochure ? "Yes" : "No"}<br/>
<b>Wants Contract:</b> ${analysis.wants_contract ? "Yes" : "No"}<br/>
<b>Wants Proposal:</b> ${analysis.wants_proposal ? "Yes" : "No"}<br/><br/>

<b>Call Summary</b><br/>
${analysis.call_summary || "N/A"}<br/><br/>

<b>Main Objection</b><br/>
${analysis.main_objection || "None"}<br/><br/>

<b>Recommended Next Action</b><br/>
${analysis.recommended_next_action || "Follow up"}<br/><br/>

<b>Retell Call ID:</b> ${call.call_id || "N/A"}
`;

  await pdRequest(`/notes`, "POST", {
    content,
    person_id: personId,
    lead_id: leadId,
  });
}

// CREATE ACTIVITY
async function createActivity(leadId, analysis) {
  if (!analysis.appointment_requested && !analysis.qualified) return;

  await pdRequest(`/activities`, "POST", {
    subject: "Follow-up Call",
    type: "call",
    lead_id: leadId,
    note: analysis.preferred_callback_time || "Follow up required",
    done: 0,
  });
}

// MAIN WEBHOOK
app.post("/webhook/retell", async (req, res) => {
  try {
    const signature = req.headers["x-retell-signature"];

    // local curl test
    if (!signature) {
      console.log("Test request received");
      return res.status(200).send("OK");
    }

    if (!verifySignature(req.rawBody, signature)) {
      return res.status(401).send("Invalid signature");
    }

    // respond fast to Retell
    res.status(200).send("OK");

    const { event, call } = req.body || {};
    console.log("Retell event:", event);

    if (event !== "call_analyzed" || !call) return;

    const analysis = call.call_analysis || {};

    const data = {
      name: analysis.lead_name,
      email: analysis.email,
      phone: analysis.phone_number || call.from_number,
    };

    const personId = await upsertPerson(data);
    const leadId = await createLead(personId, analysis, call);

    await createNote(personId, leadId, analysis, call);
    await createActivity(leadId, analysis);

    console.log("Lead processed successfully");
  } catch (err) {
    console.error("Webhook error:", err);
    if (!res.headersSent) {
      return res.status(500).send("Server error");
    }
  }
});

app.get("/", (req, res) => {
  res.send("Server is running");
});

app.listen(3000, () => {
  console.log("Webhook running on port 3000");
});
