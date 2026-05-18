export type DocsSection = {
  id: string;
  title: string;
  content: string;
};

export const DOCS_SECTIONS: DocsSection[] = [
  {
    id: "what-is-rentscreen",
    title: "What is RentScreen?",
    content: `RentScreen lets you screen rental applicants automatically using an AI-powered chat interview. Instead of manually following up with every interested tenant, you set up a screening once and share a link. Applicants answer your questions in a natural conversation, and RentScreen qualifies, rejects, or flags them for review — no manual effort required.

The whole process has two sides:
- **You (the landlord):** Configure your property, define what you want to know, and set your requirements. Then share a link.
- **Your applicants:** Visit the link, chat with the AI, and get an instant outcome.`,
  },
  {
    id: "getting-started",
    title: "Getting Started",
    content: `When you first log in, you'll see your Properties dashboard. Each property represents a listing you want to screen applicants for.

**To create your first property:**
1. Click **New Property**
2. Give it a title (e.g. "2BR Apartment on Main St") and a short description of the rental
3. Work through the tabs — Fields, Questions, Rules — to configure what you want to collect
4. Go to the **Links** tab and copy your shareable link
5. Send that link to anyone interested in the property

That's it. Applicants will chat with the AI, and you'll see their results in the Applicants section.`,
  },
  {
    id: "using-ai",
    title: "Using AI to Build Your Screening",
    content: `The fastest way to set up a property is to let AI do the heavy lifting. Describe your situation in plain English, and AI will create your questions, fields, and rules for you. Manual editing should be the exception — for small wording tweaks — not the rule.

**The recommended workflow:**
1. Write a detailed property description in the **Details** tab
2. Go to **Questions** → click **Generate with AI** → describe what you want to collect
3. Review the proposed questions and apply them
4. Go to **Rules** → type your requirements → click **Generate with AI**
5. Review the proposed rules and apply them
6. Test by opening your share link yourself, then share it

That's it. You rarely need to touch the Fields tab directly — AI creates the fields your questions and rules need automatically.

---

**Where AI is available:**

**Questions tab — bulk generation**
The main "Generate with AI" button at the bottom of the Questions tab. Type a prompt and AI will create, modify, or remove questions across your entire setup. It also creates any new fields those questions need.

**Questions tab — single question edit**
Click any individual question to select it, then use the AI input that appears to rewrite or adjust just that one question. Use this for targeted changes like "make this more conversational" or "add a follow-up if they say yes."

**Rules tab — bulk generation**
The "Generate with AI" prompt at the bottom of the Rules tab. Describe your requirements and AI will propose a full set of rules. If a rule needs a field that doesn't exist yet, AI creates it.

---

**How to write a good prompt**

The single biggest factor in quality output is how much context you give. Vague prompts produce generic results. Specific prompts produce ready-to-use results.

**Too vague:**
"Add questions about income and pets"

**Much better:**
"I'm renting a 2-bedroom apartment for $2,400/month. I need to know: monthly income (I require 3x rent), employment status, whether they have pets (no dogs allowed), their target move-in date, and how they heard about the listing. Keep the tone friendly but professional."

The difference: the second prompt tells AI your actual numbers, your actual restrictions, and the tone you want. It doesn't need to guess.

**More tips for better prompts:**
- Include your rent amount and any income multiplier you require
- List your hard no's explicitly ("no evictions", "no smoking", "no more than 2 occupants")
- Mention the property type — a room in a shared house needs different questions than a standalone unit
- If you're editing existing questions, describe what you want changed: "Remove the question about credit score and add one about rental history instead"
- If results aren't quite right, don't edit manually — refine your prompt and regenerate

---

**The clarifying questions feature**

If your prompt is ambiguous, AI will ask you a few follow-up questions before generating anything. Answer them — the more context you provide, the better the output. You can also skip them if you'd rather just see what AI produces.

---

**Reviewing AI proposals**

AI always shows you what it intends to do before making any changes. You'll see new questions it wants to add, existing questions it wants to modify, and questions it wants to remove. Review the proposal, then apply or dismiss it.

If something in the proposal is off, dismiss it and try a more specific prompt rather than accepting and fixing manually.

---

**What to edit manually (and what not to)**

Manual editing is for small, final-pass changes:
- Adjusting the exact wording of a question
- Reordering questions by drag
- Changing a rule's threshold value (e.g. $7,000 → $7,500)

If you're adding new questions, removing a section, or restructuring your flow — use AI. It's faster, and it keeps your fields and questions in sync automatically.`,
  },
  {
    id: "fields",
    title: "Fields — What You Want to Know",
    content: `Fields are the pieces of information you want to collect from each applicant. Think of them as the columns on a rental application form.

**Examples of fields you might create:**
- Monthly income (number)
- Move-in date (date)
- Has pets (yes/no)
- Current city (text)
- Employment status (a choice between "employed", "self-employed", "retired", etc.)

**Field types:**
- **Text** — any open-ended answer
- **Number** — a numeric value (income, credit score, etc.)
- **Date** — a specific date (move-in date, lease start, etc.)
- **Yes/No** — a simple true or false
- **Choice** — a fixed list of options you define

You can let AI suggest fields based on your property description by clicking **Suggest fields** — it'll propose a starter set you can tweak.

Fields are referenced by your questions and rules, so create them before building those out.`,
  },
  {
    id: "questions",
    title: "Questions — The Interview",
    content: `Questions are what the AI actually asks during the chat. You write them once; the AI delivers them conversationally to each applicant.

**How questions work:**
- Each question is tied to one or more fields. When the applicant answers, RentScreen extracts the field values automatically.
- Questions are asked in the order you define.
- If an applicant's answer covers multiple questions at once, the AI handles it gracefully.

**Conditional follow-ups:**
You can add branches to a question so that different follow-up questions are shown depending on the answer. For example:
- "Do you have pets?" → if yes, ask "How many and what kind?"

**Variables in questions:**
You can insert variables like \`{{monthly_rent}}\` into question text so the AI states your actual numbers. Define variables in the Variables tab, then reference them anywhere in your questions.

**Tips:**
- Write questions the way you'd naturally ask them in conversation
- One question per topic keeps the chat flowing naturally
- You don't need to ask about every field — if the applicant mentions something unprompted, the AI will pick it up`,
  },
  {
    id: "variables",
    title: "Variables — Reusable Values",
    content: `Variables let you define key details about your property once and reuse them across your questions.

For example, if your rent is $2,500/month, create a variable called \`monthly_rent\` with the value \`$2,500\`. Then in your questions you can write: "Our rent is {{monthly_rent}} per month — does that work for your budget?"

If you change the rent, you update it in one place and all questions update automatically.

**Common variables to create:**
- \`monthly_rent\` — the asking rent
- \`move_in_date\` — target move-in date
- \`lease_length\` — e.g. 12 months
- \`deposit_amount\` — security deposit`,
  },
  {
    id: "rules",
    title: "Rules — Automatic Screening",
    content: `Rules let you define hard requirements or disqualifiers. After the AI collects an applicant's answers, the rules engine evaluates them automatically and determines the outcome.

**Rule types:**

- **Reject** — If this condition is met, the applicant is automatically rejected. Use for hard disqualifiers (e.g. income below a threshold, has evictions).
- **Require** — The applicant must meet this condition to qualify. If they don't, they get a chance to clarify before being rejected.
- **Flag for review** — If this condition is met, the application is flagged so you can review it manually instead of auto-deciding.

**Example rules:**
- Reject if: monthly income is less than $7,500
- Reject if: has eviction history is true
- Require: credit score is greater than 650
- Flag for review: move-in date is before June 1

**AI-suggested rules:**
Click **Suggest rules** and RentScreen will propose a set of rules based on your property description and the fields you've defined. You can accept, edit, or discard each suggestion.

Rules are evaluated in order. The first violation determines the outcome, so put your most important disqualifiers first.`,
  },
  {
    id: "ai-behavior",
    title: "AI Behavior — Customize the Conversation",
    content: `The AI Behavior tab lets you control how the AI conducts the interview.

**Style instructions:**
Write a plain-English description of the tone and style you want. For example:
- "Be professional and concise. Keep responses short — two sentences max."
- "Be warm and friendly. Use casual language and make applicants feel welcome."

**Example conversations:**
Provide sample exchanges that show exactly how you want the AI to speak. The AI will match that tone and phrasing.

**Off-topic handling:**
Choose how to handle applicants who ask unrelated questions or go off-track. You can have the AI redirect them back to screening questions, or answer general property questions using your description.

**Rejection message:**
Write the message the AI delivers when an applicant doesn't qualify. You can make this as polite and specific as you like.`,
  },
  {
    id: "sharing",
    title: "Sharing Your Screening Link",
    content: `Once your property is configured, go to the **Links** tab on the property editor.

You'll see a shareable URL that looks like: \`rentscreen.app/chat/your-property-slug\`

Anyone with this link can start a screening interview — no account required. Post it in your rental listing, email it to interested applicants, or add it to a property website.

**Video and booking links:**
You can also add two optional URLs that get shared with qualified applicants at the end of their interview:
- **Video tour link** — a link to a walkthrough video of the property
- **Booking link** — a link for them to schedule a viewing (Calendly, etc.)

Qualified applicants will receive these links automatically as part of their results.`,
  },
  {
    id: "applicants",
    title: "Reviewing Applicants",
    content: `All applicant sessions are available in the **Applicants** section, accessible from the top navigation.

**Statuses:**
- **Qualified** — passed all your rules; received the booking/video links
- **Rejected** — did not meet your requirements
- **In progress** — started but hasn't finished yet
- **Review** — flagged by a rule for manual review

**Filtering:**
Use the status filter to focus on the group you care about. You can also filter by property if you have multiple listings.

**Applicant details:**
Click any applicant to expand their record and see:
- **Answers** — every field value the AI collected from the conversation
- **Chat history** — the full conversation transcript, message by message

**Deleting sessions:**
If you want to remove a test session or old record, use the delete button on the applicant card.`,
  },
  {
    id: "faq",
    title: "Frequently Asked Questions",
    content: `**What do applicants see?**
Applicants see a simple chat interface. There's no login required. They just answer questions in a natural back-and-forth with the AI.

**Can applicants lie?**
The AI collects self-reported answers. Like any application, it relies on honest responses. Use rules to flag answers that seem inconsistent, and always verify important details (income, references) before signing a lease.

**What if an applicant asks a question the AI doesn't know?**
The AI will only answer questions it can address using your property description. For anything else, it tells the applicant to contact you directly.

**Can I have multiple properties?**
Yes — create as many properties as you need. Each has its own fields, questions, rules, and share link.

**How do I test my setup before sharing it?**
Open your property's share link yourself and go through the interview as if you were an applicant. You can add \`?debug=1\` to the URL to see which fields are being extracted and how rules are evaluating in real time.

**Can I change my questions after applicants have already started?**
Yes — your configuration is live and updates apply to new sessions. Already-completed sessions are unaffected.`,
  },
];

export const DOCS_FULL_TEXT = DOCS_SECTIONS.map(
  (s) => `## ${s.title}\n\n${s.content}`,
).join("\n\n---\n\n");
