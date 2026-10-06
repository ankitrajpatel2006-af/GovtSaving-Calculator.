/* =========================================================================
   GovtSave – app.js
   -------------------------------------------------------------------------
   1. CENTRAL CONFIGURATION  ← the only place you need to edit when the
                                government revises rates or limits.
   2. Helpers
   3. Calculators (SSY, PPF, POMIS, NPS, SCSS)
   4. Pie chart (Chart.js) – destroyed and rebuilt on every recalculation
   5. PDF report (html2pdf.js)
   6. Comparison table, mobile menu, footer year
   ========================================================================= */

/* ---------- 1. CENTRAL CONFIGURATION ---------------------------------- */

/** Annual interest rates as decimals (0.082 = 8.2% p.a.). Edit here only. */
const LiveRates = {
  SSY:   0.082,   // Sukanya Samriddhi Yojana – compounded annually
  PPF:   0.071,   // Public Provident Fund   – compounded annually
  POMIS: 0.074,   // Post Office Monthly Income Scheme – simple, paid monthly
  SCSS:  0.082,   // Senior Citizens Savings Scheme – simple, paid quarterly
  FD:    0.070,   // Illustrative bank FD rate (comparison table only)
  NPS: {          // Market-linked: the user picks one of these expected returns
    options: [0.06, 0.08, 0.10, 0.12],
    default: 0.10
  }
};

/** Scheme limits and terms. Edit here if the rules change. */
const SchemeRules = {
  SSY:   { minDeposit: 250,  maxDeposit: 150000, multiple: 50, depositYears: 15, maturityYears: 21 },
  PPF:   { minDeposit: 500,  maxDeposit: 150000, multiple: 50, tenures: [15, 20, 25] },
  POMIS: { minDeposit: 1000, maxSingle: 900000, maxJoint: 1500000, multiple: 1000, years: 5 },
  NPS:   { minMonthly: 500,  maxMonthly: 1000000, minAge: 18, maxAge: 59, retirementAge: 60 },
  SCSS:  { minDeposit: 1000, maxDeposit: 3000000, multiple: 1000, years: 5 }
};

(() => {
  'use strict';

  /* ---------- 2. HELPERS ---------------------------------------------- */
  const $  = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
  const money = n => inr.format(Number.isFinite(n) ? Math.round(n) : 0);
  const pct = r => `${parseFloat((r * 100).toFixed(2))}%`;

  const COLORS = { invest: '#047857', interest: '#f59e0b' };
  const SEGMENTS = ['Total Investment', 'Estimated Interest Earned'];

  class InputError extends Error {}

  /** Parse "1,50,000" / "150000" → number (NaN when invalid). */
  const toNumber = v => Number(String(v).replace(/[,\s₹]/g, ''));

  function whole(value, min, max, multiple = 1) {
    const n = toNumber(value);
    if (!Number.isFinite(n) || !Number.isInteger(n) || n < min || n > max) return null;
    if (multiple > 1 && n % multiple !== 0) return null;
    return n;
  }

  function readAmount(card, name, lim, label) {
    const el = $(`[data-field="${name}"]`, card);
    const n = whole(el ? el.value : '', lim.min, lim.max, lim.multiple || 1);
    if (n === null) {
      const fmtNum = lim.plain ? (x => String(x)) : money;
      const step = lim.multiple > 1 ? ` (in multiples of ${money(lim.multiple)})` : '';
      throw new InputError(`Enter a whole ${label} between ${fmtNum(lim.min)} and ${fmtNum(lim.max)}${step}.`);
    }
    return n;
  }

  const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

  /* ---------- 3. CALCULATORS ------------------------------------------
     Each calculator provides:
       limits(card)          → input limits (may depend on other fields)
       read(card, limits)    → validated values, or throws InputError
       compute(values)       → { hero, invested, interest, labels…, inputs[], assumptions }
     Nothing else in the file contains a formula or a rate.
  ---------------------------------------------------------------------- */
  const CALCS = {
    /* SSY: 15 yearly deposits (start of year), maturity at year 21 */
    ssy: {
      code: 'SSY',
      title: 'Sukanya Samriddhi Yojana',
      limits: () => ({ deposit: { min: SchemeRules.SSY.minDeposit, max: SchemeRules.SSY.maxDeposit, multiple: SchemeRules.SSY.multiple, sliderStep: 250 } }),
      read: (card, lim) => ({ deposit: readAmount(card, 'deposit', lim.deposit, 'yearly deposit') }),
      compute(v) {
        const rate = LiveRates.SSY, { depositYears, maturityYears } = SchemeRules.SSY;
        let balance = 0, invested = 0;
        const breakdown = [];
        for (let year = 1; year <= maturityYears; year++) {
          if (year <= depositYears) { balance += v.deposit; invested += v.deposit; }
          balance *= 1 + rate;
          breakdown.push({ year, invested, interest: balance - invested, balance });
        }
        return {
          heroLabel: `Estimated maturity value at ${maturityYears} years`, hero: balance,
          investedLabel: `Total deposits (${depositYears} years)`, invested,
          interestLabel: 'Estimated interest earned', interest: balance - invested,
          inputs: [['Yearly deposit', money(v.deposit)], ['Deposit period', `${depositYears} years`], ['Maturity period', `${maturityYears} years`]],
          assumptions: `Interest at ${pct(rate)} p.a., compounded annually. Deposits are assumed at the start of each year for ${depositYears} years; the balance keeps earning interest until year ${maturityYears}.`,
          breakdown
        };
      }
    },

    /* PPF: yearly deposit at start of year, annual compounding */
    ppf: {
      code: 'PPF',
      title: 'Public Provident Fund',
      limits: () => ({ deposit: { min: SchemeRules.PPF.minDeposit, max: SchemeRules.PPF.maxDeposit, multiple: SchemeRules.PPF.multiple, sliderStep: 500 } }),
      read(card, lim) {
        const years = Number($('[data-field="tenure"]', card).value);
        if (!SchemeRules.PPF.tenures.includes(years)) throw new InputError('Select a valid tenure.');
        return { deposit: readAmount(card, 'deposit', lim.deposit, 'yearly deposit'), years };
      },
      compute(v) {
        const rate = LiveRates.PPF;
        let balance = 0, invested = 0;
        const breakdown = [];
        for (let y = 1; y <= v.years; y++) {
          balance += v.deposit; invested += v.deposit; balance *= 1 + rate;
          breakdown.push({ year: y, invested, interest: balance - invested, balance });
        }
        return {
          heroLabel: `Estimated maturity amount after ${v.years} years`, hero: balance,
          investedLabel: 'Total deposits', invested,
          interestLabel: 'Estimated interest earned', interest: balance - invested,
          inputs: [['Yearly deposit', money(v.deposit)], ['Tenure', `${v.years} years`]],
          assumptions: `Interest at ${pct(rate)} p.a., compounded annually, with one deposit at the start of every year. Official PPF interest is computed on monthly balances, so the actual amount can differ slightly.`,
          breakdown
        };
      }
    },

    /* POMIS: simple interest, paid monthly for 5 years */
    pomis: {
      code: 'POMIS',
      title: 'Post Office Monthly Income Scheme',
      limits(card) {
        const joint = $('[data-field="account"]', card).value === 'joint';
        return { deposit: { min: SchemeRules.POMIS.minDeposit, max: joint ? SchemeRules.POMIS.maxJoint : SchemeRules.POMIS.maxSingle, multiple: SchemeRules.POMIS.multiple, sliderStep: 1000 } };
      },
      read(card, lim) {
        const account = $('[data-field="account"]', card).value === 'joint' ? 'Joint' : 'Single';
        return { account, deposit: readAmount(card, 'deposit', lim.deposit, 'deposit') };
      },
      compute(v) {
        const rate = LiveRates.POMIS, years = SchemeRules.POMIS.years, months = years * 12;
        const monthly = v.deposit * rate / 12, totalInterest = monthly * months;
        const breakdown = [];
        for (let year = 1; year <= years; year++) {
          const interestToDate = monthly * 12 * year;
          breakdown.push({ year, invested: v.deposit, interest: interestToDate, balance: v.deposit + interestToDate });
        }
        return {
          heroLabel: 'Estimated monthly income', hero: monthly,
          heroNote: `Paid every month for ${years} years`,
          investedLabel: 'Total investment (returned at maturity)', invested: v.deposit,
          interestLabel: `Total interest over ${years} years`, interest: totalInterest,
          inputs: [['Account type', v.account], ['Deposit', money(v.deposit)], ['Term', `${years} years`]],
          extras: [['Monthly income', money(monthly)], ['Principal returned at maturity', money(v.deposit)]],
          assumptions: `Simple interest at ${pct(rate)} p.a. paid out monthly (principal × rate ÷ 12) for ${years} years. The principal is returned at maturity and is not reinvested, so in the table below "Total Balance" is your deposit plus the interest paid out to you so far — not a compounding scheme balance. Limits: single account up to ${money(SchemeRules.POMIS.maxSingle)}, joint account up to ${money(SchemeRules.POMIS.maxJoint)}.`,
          breakdown
        };
      }
    },

    /* NPS: monthly contributions until age 60 at a user-selected return */
    nps: {
      code: 'NPS',
      title: 'National Pension System',
      limits: () => ({
        monthly: { min: SchemeRules.NPS.minMonthly, max: SchemeRules.NPS.maxMonthly, multiple: 1, sliderStep: 500 },
        age:     { min: SchemeRules.NPS.minAge, max: SchemeRules.NPS.maxAge, multiple: 1, plain: true }
      }),
      read(card, lim) {
        const rate = Number($('[data-field="return"]', card).value);
        if (!LiveRates.NPS.options.includes(rate)) throw new InputError('Select a valid expected-return option.');
        return {
          monthly: readAmount(card, 'monthly', lim.monthly, 'monthly contribution'),
          age: readAmount(card, 'age', lim.age, 'current age'),
          rate
        };
      },
      compute(v) {
        const years = SchemeRules.NPS.retirementAge - v.age, months = years * 12;
        const monthlyRate = Math.pow(1 + v.rate, 1 / 12) - 1;
        let balance = 0, invested = 0;
        const breakdown = [];
        for (let m = 1; m <= months; m++) {
          balance *= 1 + monthlyRate; balance += v.monthly; invested += v.monthly;
          if (m % 12 === 0) breakdown.push({ year: m / 12, invested, interest: balance - invested, balance });
        }
        return {
          heroLabel: `Estimated corpus at age ${SchemeRules.NPS.retirementAge}`, hero: balance,
          heroNote: `${years} years of contributions · assumed return ${pct(v.rate)} p.a.`,
          investedLabel: 'Total contributions', invested,
          interestLabel: 'Estimated growth (returns)', interest: balance - invested,
          inputs: [['Monthly contribution', money(v.monthly)], ['Current age', `${v.age} years`], ['Years to age 60', `${years} years`], ['Expected return', `${pct(v.rate)} p.a.`]],
          assumptions: `NPS is market-linked, so ${pct(v.rate)} p.a. is only a hypothetical assumption, not a promise. Contributions are assumed at every month-end until age ${SchemeRules.NPS.retirementAge}. Fund charges, tax, annuity purchase and withdrawal rules are not modelled.`,
          breakdown
        };
      }
    },

    /* SCSS: simple interest, paid quarterly for 5 years */
    scss: {
      code: 'SCSS',
      title: 'Senior Citizens Savings Scheme',
      limits: () => ({ deposit: { min: SchemeRules.SCSS.minDeposit, max: SchemeRules.SCSS.maxDeposit, multiple: SchemeRules.SCSS.multiple, sliderStep: 10000 } }),
      read: (card, lim) => ({ deposit: readAmount(card, 'deposit', lim.deposit, 'deposit') }),
      compute(v) {
        const rate = LiveRates.SCSS, years = SchemeRules.SCSS.years, quarters = years * 4;
        const quarterly = v.deposit * rate / 4, totalInterest = quarterly * quarters;
        const breakdown = [];
        for (let year = 1; year <= years; year++) {
          const interestToDate = quarterly * 4 * year;
          breakdown.push({ year, invested: v.deposit, interest: interestToDate, balance: v.deposit + interestToDate });
        }
        return {
          heroLabel: 'Estimated quarterly interest', hero: quarterly,
          heroNote: `≈ ${money(quarterly / 3)} per month equivalent · paid for ${quarters} quarters`,
          investedLabel: 'Total deposit (returned at maturity)', invested: v.deposit,
          interestLabel: `Total interest over ${years} years`, interest: totalInterest,
          inputs: [['Deposit', money(v.deposit)], ['Term', `${years} years`], ['Interest payout', 'Quarterly']],
          extras: [['Quarterly interest', money(quarterly)], ['Principal returned at maturity', money(v.deposit)]],
          assumptions: `Simple interest at ${pct(rate)} p.a. paid quarterly (deposit × rate ÷ 4) for ${years} years. Deposit range ${money(SchemeRules.SCSS.minDeposit)} – ${money(SchemeRules.SCSS.maxDeposit)}. Eligibility is age-based; tax and TDS are not modelled. In the table below, "Total Balance" is your deposit plus the interest paid out to you so far — not a compounding scheme balance.`,
          breakdown
        };
      }
    }
  };

  /* ---------- 4. PIE CHART --------------------------------------------- */
  const charts = Object.create(null);

  const pieData = (invested, interest) => ({
    labels: SEGMENTS,
    datasets: [{
      data: [invested, Math.max(0, interest)],
      backgroundColor: [COLORS.invest, COLORS.interest],
      borderColor: '#ffffff', borderWidth: 3, hoverOffset: 10
    }]
  });

  /** Destroy any previous chart on this canvas, then build a fresh one. */
  function drawPie(key, canvas, invested, interest) {
    if (typeof Chart === 'undefined') {
      const wrap = canvas.parentElement;
      wrap.innerHTML = '<div class="chart-fallback">The chart could not be loaded. Your results above are still correct.</div>';
      return;
    }
    if (charts[key]) { charts[key].destroy(); delete charts[key]; }
    const stale = Chart.getChart(canvas);
    if (stale) stale.destroy();

    charts[key] = new Chart(canvas, {
      type: 'pie',
      data: pieData(invested, interest),
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 500 },
        plugins: {
          legend: { position: 'bottom', labels: { boxWidth: 12, padding: 16, font: { size: 13 } } },
          tooltip: {
            callbacks: {
              label(ctx) {
                const total = ctx.dataset.data.reduce((a, b) => a + b, 0) || 1;
                return ` ${ctx.label}: ${money(ctx.raw)} (${(ctx.raw / total * 100).toFixed(1)}%)`;
              }
            }
          }
        }
      }
    });
  }

  /** Static (no animation) chart rendered off-screen → PNG data-URL for the PDF. */
  function pieImage(invested, interest, host) {
    if (typeof Chart === 'undefined') return null;
    const canvas = document.createElement('canvas');
    canvas.width = 560; canvas.height = 560;
    host.appendChild(canvas);
    const tmp = new Chart(canvas, {
      type: 'pie',
      data: pieData(invested, interest),
      options: { responsive: false, animation: false, devicePixelRatio: 1, plugins: { legend: { display: false }, tooltip: { enabled: false } } }
    });
    const url = canvas.toDataURL('image/png');
    tmp.destroy();
    canvas.remove();
    return url;
  }

  /* ---------- Calculator wiring ---------------------------------------- */
  const state = Object.create(null);   // last valid result per calculator

  const setOut = (card, name, text) => { const el = $(`[data-out="${name}"]`, card); if (el) el.textContent = text; };

  /** Renders the Year-by-Year Growth Table from a compute() result's `breakdown` array.
   *  Safe no-op when the card has no table markup or breakdown is missing/empty. */
  function renderYearlyTable(card, breakdown) {
    const tbody = $('[data-yearly-body]', card);
    if (!tbody) return;
    if (!Array.isArray(breakdown) || !breakdown.length) { tbody.replaceChildren(); return; }

    tbody.replaceChildren(...breakdown.map(row => {
      const tr = document.createElement('tr');
      const cells = [`Year ${row.year}`, money(row.invested), money(row.interest), money(row.balance)];
      cells.forEach((text, i) => {
        const td = document.createElement('td');
        if (i === cells.length - 1) td.innerHTML = `<strong>${text}</strong>`; else td.textContent = text;
        tr.appendChild(td);
      });
      return tr;
    }));
  }

  /** Shows a short, friendly observation about the invested-vs-interest split. Safe no-op if absent. */
  function updateSmartTip(card, invested, interest) {
    const tipBox = $('[data-smart-tip]', card), tipText = $('[data-tip-text]', card);
    if (!tipBox || !tipText) return;

    let message;
    if (interest > invested) {
      message = '🔥 Power of compounding — your estimated interest is more than your total investment.';
    } else if (interest > invested * 0.5) {
      message = '📈 Solid growth — interest makes up over half of your total investment amount.';
    } else {
      message = '💡 Longer tenures let compounding do more of the work over time.';
    }
    tipText.textContent = message;
    tipBox.classList.remove('hidden');
  }

  /** Expanded/collapsed from a plain <button onclick="toggleYearlyTable(this)">, so it must live on window. */
  function toggleYearlyTable(btn) {
    const card = btn.closest('[data-calc]');
    const wrap = card ? $('[data-yearly-wrap]', card) : null;
    if (!wrap) return;
    const nowHidden = wrap.classList.toggle('hidden');
    btn.innerHTML = nowHidden
      ? '<i class="fa-solid fa-table-list"></i> Show Year-by-Year Growth Table'
      : '<i class="fa-solid fa-eye-slash"></i> Hide Growth Table';
    btn.setAttribute('aria-expanded', String(!nowHidden));
  }

  /** Shares (or copies) the current result. Called from <button onclick="sharePlan(this)">. */
  async function sharePlan(btn) {
  const card = btn.closest('[data-calc]');
  if (!card) return;

  const title =
    $('h3', card)?.textContent?.trim() || 'Savings Calculator';

  const invested =
    $('[data-out="invested"]', card)?.textContent?.trim() || '—';

  const interest =
    $('[data-out="interest"]', card)?.textContent?.trim() || '—';

  const heroAmount =
    $('[data-out="hero"]', card)?.textContent?.trim() || '';

  // Convert Indian currency text into a number
  function parseMoney(value) {
    const cleaned = String(value).replace(/[^\d.-]/g, '');
    const number = Number(cleaned);
    return Number.isFinite(number) ? number : null;
  }

  function formatMoney(value) {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0
    }).format(value);
  }

  const investedNumber = parseMoney(invested);
  const interestNumber = parseMoney(interest);

  let totalValueText = '';

  if (investedNumber !== null && interestNumber !== null) {
    totalValueText =
      `🏆 Estimated Total Value: ${formatMoney(
        investedNumber + interestNumber
      )}\n`;
  }

  const shareText =
`${title} – GovtSave

💰 Total Investment: ${invested}
📈 Estimated Interest: ${interest}
${totalValueText}
Calculate your savings plan with GovtSave.`;

  const shareUrl = window.location.href;

  const shareData = {
    title: `${title} – GovtSave`,
    text: shareText,
    url: shareUrl
  };

  const originalHTML = btn.innerHTML;

  try {
    // Mobile / supported browsers → Native Share Sheet
    if (navigator.share) {
      await navigator.share(shareData);
      return;
    }

    // Desktop / unsupported browsers → Copy to clipboard
    const completeText =
      `${shareText}\n🔗 ${shareUrl}`;

    if (navigator.clipboard) {
      await navigator.clipboard.writeText(completeText);
    } else {
      const textarea = document.createElement('textarea');
      textarea.value = completeText;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';

      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();

      document.execCommand('copy');
      textarea.remove();
    }

    btn.innerHTML =
      '<i class="fa-solid fa-check"></i> Copied!';

    setTimeout(() => {
      btn.innerHTML = originalHTML;
    }, 1800);

  } catch (error) {
    // User cancelled the native share sheet
    if (error?.name !== 'AbortError') {
      console.error('[GovtSave] Share failed:', error);
    }
  }
}

function printPlan(btn) {
  const card = btn.closest('[data-calc]');
  if (!card) return;

  const title =
    $('h3', card)?.textContent?.trim() || 'Savings Calculator';

  const invested =
    $('[data-out="invested"]', card)?.textContent?.trim() || '—';

  const interest =
    $('[data-out="interest"]', card)?.textContent?.trim() || '—';

  const heroAmount =
    $('[data-out="hero"]', card)?.textContent?.trim() || '—';

  const reportWindow = window.open('', '_blank');

  if (!reportWindow) {
    alert('Please allow pop-ups to print the report.');
    return;
  }

  reportWindow.document.write(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${title} – GovtSave Report</title>

      <style>
        * {
          box-sizing: border-box;
        }

        body {
          margin: 0;
          padding: 40px;
          font-family: Arial, sans-serif;
          color: #222;
          background: #fff;
        }

        .report {
          max-width: 760px;
          margin: 0 auto;
          border: 1px solid #ddd;
          border-radius: 14px;
          padding: 32px;
        }

        .brand {
          text-align: center;
          margin-bottom: 28px;
        }

        .brand h1 {
          margin: 0;
          font-size: 28px;
        }

        .brand p {
          margin: 8px 0 0;
          color: #666;
        }

        .scheme {
          text-align: center;
          margin-bottom: 28px;
        }

        .scheme h2 {
          margin: 0;
          font-size: 22px;
        }

        .result {
          padding: 22px;
          border: 1px solid #ddd;
          border-radius: 12px;
          margin-bottom: 20px;
        }

        .result-row {
          display: flex;
          justify-content: space-between;
          gap: 20px;
          padding: 13px 0;
          border-bottom: 1px solid #eee;
        }

        .result-row:last-child {
          border-bottom: 0;
        }

        .label {
          color: #666;
        }

        .value {
          font-weight: 700;
          text-align: right;
        }

        .total {
          margin-top: 18px;
          padding: 18px;
          border-radius: 10px;
          background: #f3f7ff;
          text-align: center;
        }

        .total span {
          display: block;
          color: #666;
          margin-bottom: 6px;
        }

        .total strong {
          font-size: 26px;
        }

        .footer {
          margin-top: 28px;
          padding-top: 18px;
          border-top: 1px solid #ddd;
          text-align: center;
          color: #777;
          font-size: 12px;
          line-height: 1.6;
        }

        .print-btn {
          display: block;
          margin: 24px auto 0;
          padding: 12px 22px;
          border: 0;
          border-radius: 8px;
          background: #222;
          color: #fff;
          cursor: pointer;
          font-size: 14px;
        }

        @media print {
          body {
            padding: 0;
          }

          .report {
            border: 0;
            padding: 20px;
          }

          .print-btn {
            display: none;
          }
        }

        @media (max-width: 600px) {
          body {
            padding: 15px;
          }

          .report {
            padding: 20px;
          }

          .result-row {
            flex-direction: column;
            gap: 5px;
          }

          .value {
            text-align: left;
          }
        }
      </style>
    </head>

    <body>
      <div class="report">

        <div class="brand">
          <h1>GovtSave</h1>
          <p>Savings & Investment Calculator Report</p>
        </div>

        <div class="scheme">
          <h2>${title}</h2>
        </div>

        <div class="result">

          <div class="result-row">
            <span class="label">Total Investment</span>
            <span class="value">${invested}</span>
          </div>

          <div class="result-row">
            <span class="label">Estimated Interest</span>
            <span class="value">${interest}</span>
          </div>

          <div class="total">
            <span>Estimated Total / Maturity Value</span>
            <strong>${heroAmount}</strong>
          </div>

        </div>

        <div class="footer">
          <p>
            This report is generated by GovtSave for educational
            and informational purposes.
          </p>

          <p>
            Calculator results are estimates based on the inputs
            and assumptions shown on the website.
          </p>

          <p>
            Please verify current scheme rates, rules and eligibility
            with the relevant official authority before making
            financial decisions.
          </p>

          <p>
            Generated on ${new Date().toLocaleDateString('en-IN')}
          </p>
        </div>

        <button class="print-btn" onclick="window.print()">
          🖨️ Print / Save as PDF
        </button>

      </div>
    </body>
    </html>
  `);

  reportWindow.document.close();
}
  function applyLimits(card, def, clampValues) {
    const limits = def.limits(card);
    Object.entries(limits).forEach(([name, l]) => {
      const input = $(`[data-field="${name}"]`, card);
      const slider = $(`[data-slider="${name}"]`, card);
      if (!input) return;
      input.min = l.min; input.max = l.max; input.step = l.multiple || 1;
      if (slider) { slider.min = l.min; slider.max = l.max; slider.step = l.sliderStep || l.multiple || 1; }
      const lo = $(`[data-help="${name}-min"]`, card), hi = $(`[data-help="${name}-max"]`, card);
      if (lo) lo.textContent = name === 'age' ? `${l.min} years` : `${money(l.min)} min`;
      if (hi) hi.textContent = name === 'age' ? `Retires at ${SchemeRules.NPS.retirementAge}` : `${money(l.max)} max`;
      if (clampValues) {
        const n = toNumber(input.value);
        if (Number.isFinite(n) && n > l.max) { input.value = String(l.max); }
        if (slider) slider.value = String(clamp(toNumber(input.value) || l.min, l.min, l.max));
      }
    });
    return limits;
  }

  function bindSliders(card, run) {
    $$('[data-slider]', card).forEach(slider => {
      const input = $(`[data-field="${slider.dataset.slider}"]`, card);
      slider.addEventListener('input', () => { input.value = slider.value; run(); });
      input.addEventListener('input', () => {
        const n = toNumber(input.value);
        if (input.value.trim() !== '' && Number.isFinite(n)) slider.value = String(clamp(n, Number(slider.min), Number(slider.max)));
      });
    });
  }

  function initCalculator(card) {
    const key = card.dataset.calc, def = CALCS[key];
    if (!def) return;

    // NPS return options come from LiveRates so they stay in one place.
    if (key === 'nps') {
      const select = $('[data-field="return"]', card);
      const hints = ['lower assumption', 'moderate assumption', 'default assumption', 'higher assumption'];
      select.replaceChildren(...LiveRates.NPS.options.map((r, i) => {
        const o = document.createElement('option');
        o.value = String(r);
        o.textContent = `${pct(r)} p.a. — ${hints[i] || 'assumption'}`;
        o.selected = r === LiveRates.NPS.default;
        return o;
      }));
    }

    const results = $('[data-results]', card);
    const dlBtn = $('[data-action="download"]', card);
    const canvas = $('[data-chart]', card);
    let timer = null;

    function run() {
      try {
        const limits = def.limits(card);
        const values = def.read(card, limits);
        const r = def.compute(values);
        state[key] = { values, result: r };

        setOut(card, 'error', '');
        $('[data-error]', card).classList.add('hidden');
        results.classList.remove('is-stale');
        if (dlBtn) dlBtn.disabled = false;

        setOut(card, 'heroLabel', r.heroLabel);
        setOut(card, 'hero', money(r.hero));
        setOut(card, 'heroNote', r.heroNote || '');
        setOut(card, 'investedLabel', r.investedLabel);
        setOut(card, 'invested', money(r.invested));
        setOut(card, 'interestLabel', r.interestLabel);
        setOut(card, 'interest', money(r.interest));
        drawPie(key, canvas, r.invested, r.interest);
        renderYearlyTable(card, r.breakdown);
        updateSmartTip(card, r.invested, r.interest);
      } catch (err) {
        const box = $('[data-error]', card);
        box.textContent = err instanceof InputError ? err.message : 'Something went wrong while calculating. Please refresh the page.';
        box.classList.remove('hidden');
        results.classList.add('is-stale');
        if (dlBtn) dlBtn.disabled = true;
        if (!(err instanceof InputError)) console.error(`[GovtSave] ${key} calculation failed:`, err);
      }
    }
    const runSoon = () => { clearTimeout(timer); timer = setTimeout(run, 120); };

    applyLimits(card, def, false);
    bindSliders(card, runSoon);

    $$('[data-field]', card).forEach(el => {
      if (el.tagName === 'SELECT') {
        el.addEventListener('change', () => { applyLimits(card, def, true); run(); });
      } else {
        el.addEventListener('input', runSoon);
      }
    });
    $('[data-action="calculate"]', card).addEventListener('click', () => { clearTimeout(timer); applyLimits(card, def, false); run(); });
    if (dlBtn) dlBtn.addEventListener('click', () => downloadReport(key, dlBtn));

    run();   // render real numbers immediately – never leave ₹0 placeholders
  }

  /* ---------- 5. PDF REPORT -------------------------------------------- */
  function reportHTML(def, s, chartUrl) {
    const r = s.result;
    const date = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' });
    const th = 'text-align:left;padding:9px 12px;background:#f1f5f9;color:#334155;font-size:12.5px;width:46%;border-bottom:1px solid #e2e8f0;';
    const td = 'padding:9px 12px;font-size:13px;font-weight:700;color:#0f172a;border-bottom:1px solid #e2e8f0;';
    const row = ([a, b]) => `<tr><th style="${th}">${a}</th><td style="${td}">${b}</td></tr>`;
    const resultRows = [
      [r.investedLabel, money(r.invested)],
      [r.interestLabel, money(r.interest)],
      ...(r.extras || []),
      ['Total value (investment + interest)', money(r.invested + r.interest)]
    ];
    const total = r.invested + Math.max(0, r.interest) || 1;
    const share = n => `${(n / total * 100).toFixed(1)}%`;
    const legend = (color, label, value) =>
      `<div style="display:flex;align-items:center;gap:10px;margin:0 0 14px;"><span style="width:14px;height:14px;border-radius:4px;background:${color};display:inline-block;"></span><div><div style="font-size:12px;color:#64748b;">${label}</div><div style="font-size:14px;font-weight:800;">${money(value)} <span style="font-weight:600;color:#64748b;font-size:12px;">(${share(value)})</span></div></div></div>`;

    return `
    <div style="width:718px;background:#ffffff;color:#0f172a;font-family:Arial,Helvetica,sans-serif;line-height:1.5;">
      <div style="background:#022c22;color:#ffffff;padding:22px 26px;border-radius:12px 12px 0 0;display:flex;justify-content:space-between;align-items:center;">
        <div>
          <div style="font-size:26px;font-weight:800;letter-spacing:-.5px;">Govt<span style="color:#34d399;">Save</span></div>
          <div style="font-size:11.5px;color:#a7f3d0;margin-top:2px;">Government savings calculators · Educational estimates</div>
        </div>
        <div style="text-align:right;font-size:11.5px;color:#a7f3d0;">Report generated<br><strong style="color:#ffffff;font-size:13px;">${date}</strong></div>
      </div>

      <div style="padding:24px 26px 8px;">
        <div style="font-size:11.5px;font-weight:800;letter-spacing:1px;color:#047857;text-transform:uppercase;">Maturity report · ${def.code}</div>
        <div style="font-size:22px;font-weight:800;margin:4px 0 16px;">${def.title}</div>

        <div style="background:#ecfdf5;border:1px solid #a7f3d0;border-radius:12px;padding:16px 20px;margin-bottom:20px;">
          <div style="font-size:12px;color:#065f46;font-weight:700;">${r.heroLabel}</div>
          <div style="font-size:30px;font-weight:800;color:#022c22;margin-top:4px;">${money(r.hero)}</div>
          ${r.heroNote ? `<div style="font-size:11.5px;color:#065f46;margin-top:3px;">${r.heroNote}</div>` : ''}
        </div>

        <div style="font-size:13px;font-weight:800;margin:0 0 8px;">Your inputs</div>
        <table style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0;margin-bottom:20px;">${r.inputs.map(row).join('')}</table>

        <div style="font-size:13px;font-weight:800;margin:0 0 8px;">Calculated results</div>
        <table style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0;margin-bottom:20px;">${resultRows.map(row).join('')}</table>

        <div style="font-size:13px;font-weight:800;margin:0 0 10px;">Investment vs interest</div>
        <div style="display:flex;align-items:center;gap:28px;border:1px solid #e2e8f0;border-radius:12px;padding:16px 20px;margin-bottom:20px;">
          ${chartUrl ? `<img src="${chartUrl}" alt="Pie chart" style="width:190px;height:190px;display:block;">` : ''}
          <div style="flex:1;">
            ${legend(COLORS.invest, SEGMENTS[0], r.invested)}
            ${legend(COLORS.interest, SEGMENTS[1], Math.max(0, r.interest))}
          </div>
        </div>

        <div style="font-size:12px;color:#475569;background:#f8fafc;border-radius:10px;padding:12px 14px;margin-bottom:14px;"><strong style="color:#0f172a;">Assumptions:</strong> ${r.assumptions}</div>
        <div style="font-size:10.5px;color:#64748b;border-top:1px solid #e2e8f0;padding-top:12px;">
          <strong>Disclaimer:</strong> This report is an illustrative estimate for educational purposes only and is not an official statement, quotation or financial advice. Actual returns, rates, eligibility, tax treatment and rules may differ and can change. Verify current details with India Post, your bank or the relevant authority before making any decision. GovtSave is not affiliated with the Government of India.
        </div>
      </div>
      <div style="text-align:center;font-size:10.5px;color:#94a3b8;padding:10px 0 4px;">Generated by GovtSave · govtsave.in</div>
    </div>`;
  }

  async function downloadReport(key, btn) {
    const def = CALCS[key], s = state[key];
    if (!s) return;
    if (typeof html2pdf === 'undefined') {
      alert('The PDF library could not be loaded. Please check your internet connection and try again.');
      return;
    }
    const original = btn.innerHTML;
    btn.disabled = true;
    btn.textContent = 'Preparing your PDF…';

    // Off-screen host. html2pdf clones the inner sheet, so the sheet itself must not be positioned off-screen.
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:-10000px;top:0;pointer-events:none;';
    document.body.appendChild(host);
    try {
      const chartUrl = pieImage(s.result.invested, s.result.interest, host);
      host.innerHTML = reportHTML(def, s, chartUrl);
      const sheet = host.firstElementChild;
      const imgs = $$('img', sheet);
      await Promise.all(imgs.map(img => img.complete ? Promise.resolve() : new Promise(res => { img.onload = img.onerror = res; })));

      await html2pdf().set({
        margin: [10, 10, 10, 10],
        filename: `GovtSave-${def.code}-Maturity-Report.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff', scrollX: 0, scrollY: 0 },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
        pagebreak: { mode: ['avoid-all'] }
      }).from(sheet).save();
    } catch (err) {
      console.error('[GovtSave] PDF generation failed:', err);
      alert('Sorry, the PDF could not be created. Please try again.');
    } finally {
      host.remove();
      btn.innerHTML = original;
      btn.disabled = false;
    }
  }

  /* ---------- 6. COMPARISON, MENU, FOOTER ------------------------------ */
  function initComparison() {
    const leftSel = $('#compare-left'), rightSel = $('#compare-right'), body = $('#comparison-body');
    if (!leftSel || !rightSel || !body) return;

    const SAMPLE = 150000;
    const schemes = {
      SSY: {
        name: 'Sukanya Samriddhi Yojana', rate: `${pct(LiveRates.SSY)} p.a. (compounded annually)`,
        tax: 'EEE under old regime, subject to rules', tenure: '21 years; deposits for 15 years',
        payout: 'Lump sum at maturity', eligibility: 'Girl child (opened by guardian)',
        outcome: () => { const r = CALCS.ssy.compute({ deposit: SAMPLE }); return `${money(r.hero)} (₹1,50,000/yr for 15 yrs)`; }
      },
      PPF: {
        name: 'Public Provident Fund', rate: `${pct(LiveRates.PPF)} p.a. (compounded annually)`,
        tax: 'EEE under old regime, subject to rules', tenure: '15 years; extension in 5-year blocks',
        payout: 'Lump sum at maturity', eligibility: 'Resident individual',
        outcome: () => { const r = CALCS.ppf.compute({ deposit: SAMPLE, years: 15 }); return `${money(r.hero)} (₹1,50,000/yr for 15 yrs)`; }
      },
      POMIS: {
        name: 'Post Office Monthly Income Scheme', rate: `${pct(LiveRates.POMIS)} p.a. (simple)`,
        tax: 'Interest taxable as applicable', tenure: '5 years',
        payout: 'Monthly interest', eligibility: 'Single up to ₹9L · Joint up to ₹15L',
        outcome: () => { const r = CALCS.pomis.compute({ account: 'Single', deposit: SAMPLE }); return `${money(r.hero)}/month · ${money(r.interest)} interest over 5 yrs`; }
      },
      SCSS: {
        name: 'Senior Citizens Savings Scheme', rate: `${pct(LiveRates.SCSS)} p.a. (simple)`,
        tax: 'Interest taxable as applicable', tenure: '5 years; extension subject to rules',
        payout: 'Quarterly interest', eligibility: 'Senior citizens (age-based)',
        outcome: () => { const r = CALCS.scss.compute({ deposit: SAMPLE }); return `${money(r.hero)}/quarter · ${money(r.interest)} interest over 5 yrs`; }
      },
      FD: {
        name: 'Bank Fixed Deposit', rate: `Illustrative ${pct(LiveRates.FD)} p.a.`,
        tax: 'Interest generally taxable', tenure: 'Depends on bank and chosen term',
        payout: 'Depends on payout option', eligibility: 'Subject to bank requirements',
        outcome: () => `${money(SAMPLE * Math.pow(1 + LiveRates.FD, 5))} (lump sum ₹1,50,000 for 5 yrs)`
      }
    };

    function render() {
      const l = schemes[leftSel.value], r = schemes[rightSel.value];
      $('#compare-left-title').textContent = l.name;
      $('#compare-right-title').textContent = r.name;
      const rows = [
        ['Indicative rate', l.rate, r.rate], ['Tax treatment', l.tax, r.tax],
        ['Tenure / lock-in', l.tenure, r.tenure], ['Payout structure', l.payout, r.payout],
        ['Eligibility / limits', l.eligibility, r.eligibility],
        ['Illustrative outcome', l.outcome(), r.outcome()]
      ];
      body.replaceChildren(...rows.map(row => {
        const tr = document.createElement('tr');
        row.forEach((text, i) => { const cell = document.createElement('td'); if (i === 0) cell.style.fontWeight = '700'; cell.textContent = text; tr.appendChild(cell); });
        return tr;
      }));
    }
    leftSel.addEventListener('change', render);
    rightSel.addEventListener('change', render);
    render();
  }

  function initChrome() {
    // Fill every [data-rate="SSY"] with the live rate so pages never hard-code a number.
    $$('[data-rate]').forEach(el => {
      const r = LiveRates[el.dataset.rate];
      if (typeof r === 'number') el.textContent = pct(r);
    });
    const year = $('#footer-year');
    if (year) year.textContent = String(new Date().getFullYear());

    const btn = $('#mobile-menu-btn'), menu = $('#mobile-menu');
    if (btn && menu) {
      btn.addEventListener('click', () => { btn.setAttribute('aria-expanded', String(menu.classList.toggle('open'))); });
      $$('a', menu).forEach(a => a.addEventListener('click', () => { menu.classList.remove('open'); btn.setAttribute('aria-expanded', 'false'); }));
    }
  }

  /* ---------- Boot ----------------------------------------------------- */
  function boot() {
    initChrome();
    $$('[data-calc]').forEach(card => {
      try { initCalculator(card); }
      catch (err) { console.error(`[GovtSave] Could not start calculator "${card.dataset.calc}":`, err); }
    });
    try { initComparison(); } catch (err) { console.error('[GovtSave] Comparison failed:', err); }
  }

  // Scripts use `defer`, so the DOM is ready; the check keeps it safe if loaded another way.
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  // Exposed on window only because inline onclick="…" handlers in the HTML run in global
  // scope. Everything else in this file stays private inside this one IIFE — no scope breaks.
  window.toggleYearlyTable = toggleYearlyTable;
  window.sharePlan = sharePlan;
})();
/* =========================================================
   PHASE 1 - MONTHLY INVESTMENT PLANNER
   Standalone add-on
========================================================= */

(() => {
  'use strict';

  const monthlyInput = document.getElementById('planner-monthly');
  const yearsInput = document.getElementById('planner-years');
  const rateInput = document.getElementById('planner-rate');
  const calculateButton = document.getElementById('planner-calculate');

  const finalValueOutput = document.getElementById('planner-final-value');
  const investedOutput = document.getElementById('planner-invested');
  const returnsOutput = document.getElementById('planner-returns');

  if (
    !monthlyInput ||
    !yearsInput ||
    !rateInput ||
    !calculateButton ||
    !finalValueOutput ||
    !investedOutput ||
    !returnsOutput
  ) {
    return;
  }

  const formatMoney = value => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0
    }).format(Math.round(value));
  };

  function calculatePlanner() {
    const monthly = Number(monthlyInput.value);
    const years = Number(yearsInput.value);
    const annualRate = Number(rateInput.value) / 100;

    if (!Number.isFinite(monthly) || monthly < 500 || monthly > 1000000) {
      finalValueOutput.textContent = 'Enter valid amount';
      investedOutput.textContent = '—';
      returnsOutput.textContent = '—';
      return;
    }

    if (!Number.isFinite(years) || years <= 0) {
      finalValueOutput.textContent = 'Select period';
      investedOutput.textContent = '—';
      returnsOutput.textContent = '—';
      return;
    }

    if (!Number.isFinite(annualRate) || annualRate < 0) {
      finalValueOutput.textContent = 'Select return';
      investedOutput.textContent = '—';
      returnsOutput.textContent = '—';
      return;
    }

    const months = years * 12;

    /*
      Monthly investment calculation:
      - Monthly contribution is made at the end of each month.
      - Annual return is converted to an equivalent monthly rate.
    */
    const monthlyRate =
      Math.pow(1 + annualRate, 1 / 12) - 1;

    let futureValue = 0;

    for (let month = 1; month <= months; month++) {
      futureValue += monthly;

      if (monthlyRate > 0) {
        futureValue *= 1 + monthlyRate;
      }
    }

    const totalInvested = monthly * months;
    const estimatedReturns = Math.max(
      0,
      futureValue - totalInvested
    );

    finalValueOutput.textContent = formatMoney(futureValue);
    investedOutput.textContent = formatMoney(totalInvested);
    returnsOutput.textContent = formatMoney(estimatedReturns);
  }

  calculateButton.addEventListener('click', calculatePlanner);

  /*
    Calculate automatically on page load,
    so the planner never remains blank.
  */
  calculatePlanner();

})();
/* =========================================================
   PHASE 2 - WEBSITE SEARCH
   Standalone add-on
========================================================= */

(() => {
  'use strict';

  const searchBox = document.getElementById('site-search');
  const searchInput = document.getElementById('site-search-input');
  const clearButton = document.getElementById('site-search-clear');

  if (!searchBox || !searchInput || !clearButton) {
    return;
  }

  const searchableItems = Array.from(
    document.querySelectorAll(
      '.calculator-card, .guide-card, .rate-card, .faq-item'
    )
  );

  function updateSearchState() {
    searchBox.classList.toggle(
      'has-value',
      searchInput.value.trim().length > 0
    );
  }

  function clearSearch() {
    searchInput.value = '';

    searchableItems.forEach(item => {
      item.style.display = '';
    });

    updateSearchState();
    searchInput.focus();
  }

  function performSearch() {
    const query = searchInput.value.trim().toLowerCase();

    updateSearchState();

    if (!query) {
      searchableItems.forEach(item => {
        item.style.display = '';
      });
      return;
    }

    searchableItems.forEach(item => {
      const text = item.textContent.toLowerCase();

      item.style.display = text.includes(query) ? '' : 'none';
    });
  }

  searchInput.addEventListener('input', performSearch);

  clearButton.addEventListener('click', clearSearch);

  searchInput.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      clearSearch();
    }
  });

})();
(() => {
  'use strict';

  const toggle = document.getElementById('theme-toggle');
  if (!toggle) return;

  const root = document.documentElement;
  const savedTheme = localStorage.getItem('govtsave-theme');

  function applyTheme(theme) {
    const dark = theme === 'dark';

    root.classList.toggle('dark-mode', dark);

    toggle.innerHTML = dark
      ? '<i class="fa-solid fa-sun"></i>'
      : '<i class="fa-solid fa-moon"></i>';

    toggle.setAttribute(
      'aria-label',
      dark ? 'Switch to light mode' : 'Switch to dark mode'
    );

    toggle.setAttribute(
      'title',
      dark ? 'Switch to light mode' : 'Switch to dark mode'
    );
  }

  applyTheme(savedTheme === 'dark' ? 'dark' : 'light');

  toggle.addEventListener('click', () => {
    const nextTheme = root.classList.contains('dark-mode')
      ? 'light'
      : 'dark';

    localStorage.setItem('govtsave-theme', nextTheme);

    applyTheme(nextTheme);
  });
})();
/* =========================
   STEP 10 - PREMIUM COMPARISON CHART
========================== */

(() => {
  'use strict';

  function createPremiumComparisonChart() {
    const canvas = document.getElementById('scheme-comparison-chart');

    if (!canvas) return;

    if (typeof Chart === 'undefined') {
      setTimeout(createPremiumComparisonChart, 300);
      return;
    }

    const existingChart = Chart.getChart(canvas);

    if (existingChart) {
      existingChart.destroy();
    }

    const dark = document.documentElement.classList.contains('dark-mode');

    const textColor = dark ? '#cbd5e1' : '#64748b';
    const gridColor = dark
      ? 'rgba(148, 163, 184, 0.12)'
      : 'rgba(100, 116, 139, 0.12)';

    const labels = [
      'SSY',
      'PPF',
      'SCSS',
      'POMIS',
      'Bank FD'
    ];

    const rates = [
      8.2,
      7.1,
      8.2,
      7.4,
      7.0
    ];

    const chart = new Chart(canvas, {
      type: 'bar',

      data: {
        labels: labels,

        datasets: [{
          label: 'Interest Rate',

          data: rates,

          borderWidth: 0,

          borderRadius: 12,

          borderSkipped: false,

          maxBarThickness: 58,

          backgroundColor: [
            'rgba(79, 70, 229, 0.88)',
            'rgba(14, 165, 233, 0.88)',
            'rgba(16, 185, 129, 0.88)',
            'rgba(245, 158, 11, 0.88)',
            'rgba(100, 116, 139, 0.78)'
          ],

          hoverBackgroundColor: [
            'rgba(79, 70, 229, 1)',
            'rgba(14, 165, 233, 1)',
            'rgba(16, 185, 129, 1)',
            'rgba(245, 158, 11, 1)',
            'rgba(100, 116, 139, 1)'
          ]
        }]
      },

      options: {
        responsive: true,

        maintainAspectRatio: false,

        animation: {
          duration: 900,
          easing: 'easeOutQuart'
        },

        interaction: {
          intersect: false,
          mode: 'index'
        },

        plugins: {

          legend: {
            display: false
          },

          tooltip: {
            backgroundColor: dark
              ? '#020617'
              : '#0f172a',

            titleColor: '#ffffff',

            bodyColor: '#e2e8f0',

            padding: 14,

            cornerRadius: 10,

            displayColors: false,

            callbacks: {
              title: function(context) {
                return context[0].label;
              },

              label: function(context) {
                return 'Interest Rate: ' + context.parsed.y + '%';
              }
            }
          }
        },

        scales: {

          y: {
            beginAtZero: true,

            max: 10,

            border: {
              display: false
            },

            grid: {
              color: gridColor,
              drawTicks: false
            },

            ticks: {
              color: textColor,

              padding: 10,

              callback: function(value) {
                return value + '%';
              }
            },

            title: {
              display: true,

              text: 'Interest Rate (%)',

              color: textColor,

              font: {
                size: 12,
                weight: '600'
              }
            }
          },

          x: {

            border: {
              display: false
            },

            grid: {
              display: false
            },

            ticks: {
              color: textColor,

              padding: 10,

              font: {
                size: 12,
                weight: '600'
              }
            }
          }
        }
      },

      plugins: [{
        id: 'premiumRateLabels',

        afterDatasetsDraw(chart) {

          const ctx = chart.ctx;

          ctx.save();

          chart.data.datasets.forEach((dataset, datasetIndex) => {

            const meta = chart.getDatasetMeta(datasetIndex);

            meta.data.forEach((bar, index) => {

              const value = dataset.data[index];

              ctx.fillStyle = dark
                ? '#f8fafc'
                : '#0f172a';

              ctx.font = '700 12px Arial';

              ctx.textAlign = 'center';

              ctx.textBaseline = 'bottom';

              ctx.fillText(
                value + '%',
                bar.x,
                bar.y - 8
              );
            });
          });

          ctx.restore();
        }
      }]
    });

    function refreshChartTheme() {

      const isDark =
        document.documentElement.classList.contains('dark-mode');

      const newTextColor =
        isDark ? '#cbd5e1' : '#64748b';

      const newGridColor =
        isDark
          ? 'rgba(148, 163, 184, 0.12)'
          : 'rgba(100, 116, 139, 0.12)';

      chart.options.scales.y.ticks.color = newTextColor;

      chart.options.scales.x.ticks.color = newTextColor;

      chart.options.scales.y.title.color = newTextColor;

      chart.options.scales.y.grid.color = newGridColor;

      chart.options.plugins.tooltip.backgroundColor =
        isDark ? '#020617' : '#0f172a';

      chart.update();
    }

    const themeToggle =
      document.getElementById('theme-toggle');

    if (themeToggle) {
      themeToggle.addEventListener(
        'click',
        function() {
          setTimeout(refreshChartTheme, 80);
        }
      );
    }
  }

  function startPremiumChart() {
    createPremiumComparisonChart();
  }

  if (document.readyState === 'loading') {

    document.addEventListener(
      'DOMContentLoaded',
      function() {
        setTimeout(startPremiumChart, 500);
      }
    );

  } else {

    setTimeout(startPremiumChart, 500);

  }

})();
/* =========================
   STEP 11 - SCHEME QUIZ LOGIC
========================== */

(() => {
  'use strict';

  const quizCard = document.querySelector('.scheme-quiz-card');
  const questions = document.querySelectorAll('.quiz-question');
  const resultBox = document.getElementById('quiz-result');
  const resultTitle = document.getElementById('quiz-result-title');
  const resultDescription = document.getElementById('quiz-result-description');
  const calculatorLink = document.getElementById('quiz-calculator-link');
  const restartButton = document.getElementById('quiz-restart');

  if (
    !quizCard ||
    !questions.length ||
    !resultBox ||
    !resultTitle ||
    !resultDescription ||
    !calculatorLink ||
    !restartButton
  ) {
    return;
  }

  let currentQuestion = 0;

  const answers = [];

  const schemeResults = {
    PPF: {
      title: 'PPF may suit you better',
      description:
        'PPF may be worth considering if your priority is long-term, disciplined savings with a relatively stable government-backed savings structure.',
      link: '#ppf-calculator'
    },

    SSY: {
      title: 'SSY may suit you better',
      description:
        'SSY may be worth considering for eligible families planning long-term savings specifically for a girl child.',
      link: '#ssy-calculator'
    },

    SCSS: {
      title: 'SCSS may suit you better',
      description:
        'SCSS may be worth considering for eligible senior citizens who are looking for a savings option focused on regular interest income.',
      link: '#scss-calculator'
    },

    POMIS: {
      title: 'POMIS may suit you better',
      description:
        'POMIS may be worth considering if your priority is receiving regular income from a post-office savings scheme.',
      link: '#pomis-calculator'
    },

    NPS: {
      title: 'NPS may suit you better',
      description:
        'NPS may be worth considering if your main goal is long-term retirement planning and you are comfortable with market-linked investment exposure.',
      link: '#nps-calculator'
    }
  };


  function showQuestion(index) {

    questions.forEach((question, questionIndex) => {
      question.classList.toggle(
        'active',
        questionIndex === index
      );
    });

    resultBox.classList.remove('show');
  }


  function calculateResult() {

    const score = {
      PPF: 0,
      SSY: 0,
      SCSS: 0,
      POMIS: 0,
      NPS: 0
    };


    answers.forEach(answer => {

      switch (answer) {

        case 'long':
          score.PPF += 3;
          score.SSY += 3;
          score.NPS += 2;
          break;

        case 'income':
          score.POMIS += 3;
          score.SCSS += 2;
          break;

        case 'growth':
          score.NPS += 4;
          score.PPF += 2;
          break;

        case 'low':
          score.PPF += 3;
          score.SSY += 2;
          score.SCSS += 2;
          score.POMIS += 2;
          break;

        case 'moderate':
          score.NPS += 4;
          score.PPF += 1;
          break;

        case 'young':
          score.PPF += 2;
          score.NPS += 3;
          break;

        case 'middle':
          score.PPF += 2;
          score.NPS += 2;
          break;

        case 'senior':
          score.SCSS += 4;
          score.POMIS += 3;
          break;

        case 'monthly':
          score.PPF += 3;
          score.NPS += 3;
          break;

        case 'lumpsum':
          score.PPF += 2;
          score.POMIS += 1;
          break;

        case 'income':
          score.POMIS += 3;
          score.SCSS += 2;
          break;
      }
    });


    const highestScheme = Object.keys(score).reduce(
      (best, scheme) =>
        score[scheme] > score[best] ? scheme : best,
      'PPF'
    );


    const result = schemeResults[highestScheme];

    resultTitle.textContent = result.title;

    resultDescription.textContent = result.description;

    calculatorLink.href = result.link;


    questions.forEach(question => {
      question.classList.remove('active');
    });

    resultBox.classList.add('show');

    resultBox.scrollIntoView({
      behavior: 'smooth',
      block: 'center'
    });
  }


  quizCard.addEventListener('click', event => {

    const option = event.target.closest('.quiz-option');

    if (!option) return;

    const value = option.dataset.value;

    if (!value) return;

    answers[currentQuestion] = value;

    if (currentQuestion < questions.length - 1) {

      currentQuestion++;

      showQuestion(currentQuestion);

    } else {

      calculateResult();

    }
  });


  restartButton.addEventListener('click', () => {

    currentQuestion = 0;

    answers.length = 0;

    showQuestion(0);

    quizCard.scrollIntoView({
      behavior: 'smooth',
      block: 'center'
    });
  });
  window.printPlan = printPlan;
  showQuestion(0);

})();
