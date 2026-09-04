import json
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.datavalidation import DataValidation

SRC = "data/demo-scenarios.json"
OUT = "docs/novamart-demo-runsheet.xlsx"

d = json.load(open(SRC))
sc = d["scenarios"]

FONT = "Arial"
HDR_BG = PatternFill("solid", start_color="1F2A44")
HDR_FONT = Font(name=FONT, bold=True, color="FFFFFF", size=10)
BASE = Font(name=FONT, size=10)
BOLD = Font(name=FONT, size=10, bold=True)
MUTED = Font(name=FONT, size=9, color="5B6270")
TITLE = Font(name=FONT, size=14, bold=True, color="1F2A44")
WRAP = Alignment(wrap_text=True, vertical="top")
TOP = Alignment(vertical="top")
CENTER = Alignment(horizontal="center", vertical="top")
thin = Side(style="thin", color="D9DDE5")
BORDER = Border(left=thin, right=thin, top=thin, bottom=thin)

STATUS_FILL = {
    "resolved": PatternFill("solid", start_color="E6F6F0"),
    "escalated": PatternFill("solid", start_color="F1ECFD"),
    "needs_input": PatternFill("solid", start_color="FDF1E3"),
}
STATUS_FONT = {
    "resolved": Font(name=FONT, size=10, bold=True, color="0F7A56"),
    "escalated": Font(name=FONT, size=10, bold=True, color="6D4BC4"),
    "needs_input": Font(name=FONT, size=10, bold=True, color="A85A12"),
}

wb = Workbook()

# ---------------------------------------------------------------- Run sheet
ws = wb.active
ws.title = "Run sheet"

ws["A1"] = "NovaMart — live demo run sheet"
ws["A1"].font = TITLE
ws["A2"] = (
    f'{len(sc)} scenarios · generated {d["generatedAt"][:10]} from the live database · '
    f'pinned AS_OF_DATE={d["asOf"]} (date shift {d["shiftDays"]} days)'
)
ws["A2"].font = MUTED
ws["A3"] = (
    "Ids are real rows. If you change AS_OF_DATE, regenerate with `npm run demo:build` "
    "or the day counts below stop being true."
)
ws["A3"].font = MUTED

HEAD = [
    ("#", 5),
    ("Run", 6),
    ("Scenario", 26),
    ("Order id", 10),
    ("Customer id", 12),
    ("What to type", 40),
    ("Expected status", 15),
    ("Expected agent", 19),
    ("Reason code", 20),
    ("What it proves", 52),
    ("Tools exercised", 34),
]
r = 5
for i, (h, w) in enumerate(HEAD, start=1):
    c = ws.cell(row=r, column=i, value=h)
    c.font = HDR_FONT
    c.fill = HDR_BG
    c.alignment = CENTER if h in ("#", "Run") else Alignment(vertical="center", wrap_text=True)
    c.border = BORDER
    ws.column_dimensions[get_column_letter(i)].width = w
ws.row_dimensions[r].height = 28

dv = DataValidation(type="list", formula1='",PASS,FAIL,SKIP"', allow_blank=True)
ws.add_data_validation(dv)

first = r + 1
for n, s in enumerate(sc, start=1):
    row = r + n
    st = s["expect"]["status"]
    vals = [
        n,
        None,
        s["title"],
        s["identity"].get("orderId"),
        s["identity"].get("userId"),
        s["message"],
        st,
        s["expect"]["agent"],
        s["expect"].get("reasonCode", "—"),
        s["expect"]["note"],
        ", ".join(t.replace("mcp__novamart__", "") for t in s["exercises"]) or "—",
    ]
    for i, v in enumerate(vals, start=1):
        c = ws.cell(row=row, column=i, value=v)
        c.font = BASE
        c.alignment = WRAP if i in (3, 6, 10, 11) else (CENTER if i in (1, 2, 4, 5, 7) else TOP)
        c.border = BORDER
    ws.cell(row=row, column=7).fill = STATUS_FILL[st]
    ws.cell(row=row, column=7).font = STATUS_FONT[st]
    ws.cell(row=row, column=4).number_format = "0"
    ws.cell(row=row, column=5).number_format = "0"
    dv.add(ws.cell(row=row, column=2))
last = r + len(sc)

ws.freeze_panes = "C6"
ws.auto_filter.ref = f"A{r}:K{last}"

# Live tally. Formulas, not values — this is the column filled in during the demo.
t = last + 2
ws.cell(row=t, column=3, value="Result tally").font = BOLD
for off, (label, formula) in enumerate(
    [
        ("PASS", f'=COUNTIF(B{first}:B{last},"PASS")'),
        ("FAIL", f'=COUNTIF(B{first}:B{last},"FAIL")'),
        ("SKIP", f'=COUNTIF(B{first}:B{last},"SKIP")'),
        ("Not run", f'=COUNTBLANK(B{first}:B{last})'),
        ("Total", f"=COUNTA(A{first}:A{last})"),
    ]
):
    ws.cell(row=t + 1 + off, column=3, value=label).font = BASE
    cell = ws.cell(row=t + 1 + off, column=4, value=formula)
    cell.font = BASE
    cell.alignment = CENTER

# ---------------------------------------------------------------- Coverage
cv = wb.create_sheet("Coverage")
cv["A1"] = "Coverage matrix"
cv["A1"].font = TITLE
cv["A2"] = "Which scenario exercises what. A row with no X is a gap in the demo set."
cv["A2"].font = MUTED

AGENTS = ["order-specialist", "faq-policy", "plus-specialist", "returns-advisor", "escalation-handoff", "triage-router"]
TOOLS = ["get_order", "get_order_items", "list_orders_for_user", "search_policy", "get_membership", "get_processing_calendar", "create_ticket_stub", "format_handoff_summary"]
REASONS = ["payment_or_refund", "restricted_action", "ungrounded", "customer_requested_human"]
STATUSES = ["resolved", "escalated", "needs_input"]

hr = 4
cv.cell(row=hr, column=1, value="Dimension").font = HDR_FONT
cv.cell(row=hr, column=1).fill = HDR_BG
cv.cell(row=hr, column=2, value="Value").font = HDR_FONT
cv.cell(row=hr, column=2).fill = HDR_BG
cv.cell(row=hr, column=3, value="Scenarios").font = HDR_FONT
cv.cell(row=hr, column=3).fill = HDR_BG
cv.cell(row=hr, column=4, value="Count").font = HDR_FONT
cv.cell(row=hr, column=4).fill = HDR_BG
cv.column_dimensions["A"].width = 14
cv.column_dimensions["B"].width = 26
cv.column_dimensions["C"].width = 62
cv.column_dimensions["D"].width = 8

row = hr + 1
for dim, values, getter in [
    ("Agent", AGENTS, lambda s: [s["expect"]["agent"]]),
    ("Status", STATUSES, lambda s: [s["expect"]["status"]]),
    ("Reason code", REASONS, lambda s: [s["expect"]["reasonCode"]] if s["expect"].get("reasonCode") else []),
    ("Tool", TOOLS, lambda s: s["exercises"]),
]:
    for v in values:
        hits = [str(i) for i, s in enumerate(sc, start=1) if v in getter(s)]
        cv.cell(row=row, column=1, value=dim).font = BASE
        cv.cell(row=row, column=2, value=v).font = BASE
        cv.cell(row=row, column=3, value=", ".join(hits) if hits else "— NOT COVERED").font = (
            BASE if hits else Font(name=FONT, size=10, bold=True, color="B42318")
        )
        cv.cell(row=row, column=4, value=len(hits)).font = BASE
        cv.cell(row=row, column=4).alignment = CENTER
        for col in range(1, 5):
            cv.cell(row=row, column=col).border = BORDER
        row += 1
cv.freeze_panes = "A5"

# ---------------------------------------------------------------- Setup
st = wb.create_sheet("Setup")
st["A1"] = "How to run the demo"
st["A1"].font = TITLE
lines = [
    ("Full demo — one command", "bold"),
    ("npm run demo", "mono"),
    ("", None),
    ("It prints where to look, then starts the app. Opens on:", None),
    ("http://localhost:3000/?demo=1", "mono"),
    ("", None),
    ("What to have open on screen", "bold"),
    ("1. The app          http://localhost:3000/?demo=1   (add &trace=1 for the hop panel)", None),
    ("2. Arize            https://app.arize.com  ->  project novamart-support-crew", None),
    ("3. The outbox       data/outbox.md   grows with every handoff", None),
    ("4. A ticket packet  data/tickets/<STUB-ID>.md   what the human receives", None),
    ("", None),
    ("Rehearse for free", "bold"),
    ("npm run dev", "mono"),
    ("Same UI, same picker, same ticket and outbox artifacts — no crew, no API usage.", None),
    ("Escalation is structural on both engines, so the handoff artifacts still appear.", None),
    ("", None),
    ("Confirm you are on the crew before you start", "bold"),
    ('curl -s localhost:3000/api/health    ->    "engine":"sdk"', "mono"),
    ("", None),
    ("After the demo", "bold"),
    ("npm run observability      run rate, error rate, latency, TTFT, cost by agent path", "mono"),
    ("npm run prune:traces       sweep trace logs and handoff artifacts (7-day window)", "mono"),
    ("", None),
    ("Notes", "bold"),
    ("Each crew turn is a real model call. A full 23-scenario pass is roughly $4-6 of usage.", None),
    ("SDK_STREAM_MODE=live is set by the script. The default (final) shows nothing for 10-16s", None),
    ("then dumps the whole answer at once — much worse to watch.", None),
    ("Keep AS_OF_DATE=2026-09-01 or the day counts in the Run sheet stop matching the screen.", None),
    ("Arize traces appear a few seconds AFTER a turn finishes — spans are replayed at turn end,", None),
    ("so do not switch to the Arize tab until the answer is on screen.", None),
    ("The picker lists real order ids. Keep it off for anything customer-facing.", None),
]
r2 = 3
for text, style in lines:
    c = st.cell(row=r2, column=1, value=text)
    if style == "mono":
        c.font = Font(name="Courier New", size=10, color="1F4FD8")
    elif style == "bold":
        c.font = BOLD
    elif text.startswith(("1.", "2.", "3.", "4.")):
        c.font = BOLD
    else:
        c.font = BASE
    r2 += 1
st.column_dimensions["A"].width = 108

wb.save(OUT)
print("wrote", OUT)
