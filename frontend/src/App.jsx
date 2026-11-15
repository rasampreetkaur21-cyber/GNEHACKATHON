import LiveAppointment,{LiveInvitations} from "./components/LiveAppointment";
import ManualDecision from "./components/ManualDecision";
import LiveDeviceCheck from "./components/LiveDeviceCheck";
import {CompanyGate,CompanyLogin,CompanyDashboard,homeFor} from "./pages/Company";
import CustomerClaimStatus from "./components/CustomerClaimStatus";
import VerifyDevice from "./pages/VerifyDevice";
import GuidedClaim from "./components/GuidedClaim";
import { useState, useEffect } from "react";
import {
  Link,
  NavLink,
  Routes,
  Route,
  Navigate,
  useNavigate,
  useParams,
  useLocation,
} from "react-router-dom";
import {
  ShieldCheck,
  ArrowUpRight,
  ArrowRight,
  Plus,
  LayoutDashboard,
  ClipboardList,
  FileCheck2,
  Search,
  Upload,
  Check,
  Clock,
  LogOut,
  ChevronRight,
  LockKeyhole,
  ScanLine,
  FileText,
} from "lucide-react";
import { useAuth } from "./context/Auth";
import { api, uploadEvidence } from "./services/api";
import EvidenceAnalysis from "./components/EvidenceAnalysis";
import EvidenceUpload from "./components/EvidenceUpload";
import EvidenceLedger from "./components/EvidenceLedger";
import InvestigatorChat from "./pages/InvestigatorChat";
import {
  BrandSelect,
  ModelFields,
  selectedDevice,
} from "./components/DeviceFields";
import { toMinor } from "./utils/money";
const label = (s) => s?.replaceAll("_", " ").toLowerCase();
const date = (s) =>
  s
    ? new Date(
        s.includes("T") ? s : s.replace(" ", "T") + "Z",
      ).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "—";
function Badge({ value, text }) {
  return (
    <span
      className={
        "badge " +
        (value === "APPROVED" || value === "PASS" || value === "AUTO_APPROVE"
          ? "green"
          : value === "REJECTED" ||
              value === "FAIL" ||
              value === "REJECT_RECOMMENDED"
            ? "rose"
            : "amber")
      }
    >
      {text || label(value)}
    </span>
  );
}
function ErrorBox({ error }) {
  return error ? (
    <div role="alert" className="error">
      {error}
    </div>
  ) : null;
}
function Logo() {
  return (
    <Link className="logo" to="/">
      <span className="logo-icon">
        <ShieldCheck size={23} />
      </span>
      ClaimShield<span className="ai">AI</span>
    </Link>
  );
}
function Landing() {
  return (
    <div className="landing">
      <header className="public-nav">
        <Logo />
        <div>
          <Link to="/company" className="quiet">Company Login</Link>
          <Link to="/reviewer/login" className="quiet">
            Reviewer access
          </Link>
          <Link className="button small" to="/login">
            Customer login <ArrowUpRight size={16} />
          </Link>
        </div>
      </header>
      <main>
        <div className="hero">
          <div>
            <div className="eyebrow">
              <span className="dot" /> CLEAR EVIDENCE. CONFIDENT DECISIONS.
            </div>
            <h1>
              A better path from
              <br />
              claim to <em>clarity.</em>
            </h1>
            <p className="hero-copy">
              Warranty claims deserve a fair review. Bring your product details
              and evidence together in one secure place, with transparent
              updates at every step.
            </p>
            <div className="hero-actions">
              <Link className="button" to="/register">
                Start a warranty claim <ArrowRight size={18} />
              </Link>
              <Link className="text-link" to="/login">
                Track your claim <ArrowUpRight size={16} />
              </Link>
            </div>
            <div className="trust">
              <LockKeyhole size={15} /> Private evidence <span>·</span>{" "}
              Transparent rules <span>·</span> Human decisions
            </div>
          </div>
          <div className="hero-board">
            <div className="board-header">
              <span className="eyebrow">THE CLAIMSHIELD APPROACH</span>
              <ShieldCheck size={26} />
            </div>
            <h2>
              Every detail.
              <br />A clearer picture.
            </h2>
            <div className="process-item">
              <span>
                <FileText />
              </span>
              <div>
                <strong>01 / Bring it together</strong>
                <p>Product, purchase, and supporting evidence.</p>
              </div>
              <Check size={17} />
            </div>
            <div className="process-item">
              <span>
                <ScanLine />
              </span>
              <div>
                <strong>02 / Check the facts</strong>
                <p>Consistent rules. Traceable explanations.</p>
              </div>
              <Check size={17} />
            </div>
            <div className="process-item">
              <span>
                <FileCheck2 />
              </span>
              <div>
                <strong>03 / Review with care</strong>
                <p>A person makes the final decision.</p>
              </div>
              <ArrowUpRight size={17} />
            </div>
            <div className="board-note">
              <span className="dot" /> Built for fair, evidence-led review
            </div>
          </div>
        </div>
        <section className="landing-bottom">
          <div className="eyebrow">
            LESS UNCERTAINTY.
            <br />
            MORE VISIBILITY.
          </div>
          <div>
            <h3>Your claim, without the guesswork.</h3>
            <p>
              Upload documents securely, see what is missing, and follow your
              reviewer’s updates. AI assistance is optional; decisions always
              stay accountable.
            </p>
          </div>
          <ShieldCheck size={50} strokeWidth={1} />
        </section>
      </main>
      <footer>
        © {new Date().getFullYear()} ClaimShield AI{" "}
        <span>Warranty clarity, by design.</span>
      </footer>
    </div>
  );
}
function Login({ register = false, reviewer = false }) {
  const { user, setUser } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  if (user)
    return (
      <Navigate to={homeFor(user)} />
    );
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const f = Object.fromEntries(new FormData(e.currentTarget));
    try {
      const d = await api(register ? "/auth/register" : "/auth/login", {
        method: "POST",
        body: f,
      });
      setUser(d.user);
      navigate(homeFor(d.user));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth-layout">
      <aside>
        <Logo />
        <div>
          <span className="eyebrow">WARRANTY CLARITY, BY DESIGN</span>
          <h1>
            Good decisions
            <br />
            start with
            <br />
            <em>clear evidence.</em>
          </h1>
          <p>
            One secure workspace. A transparent process.
            <br />
            People at the heart of every decision.
          </p>
        </div>
        <span className="eyebrow">CLAIMSHIELD AI / FOUNDATION</span>
      </aside>
      <main className="auth-main">
        <Link to="/" className="quiet">
          ← Back to home
        </Link>
        <div className="auth-card">
          <div className="icon-box">
            <ShieldCheck />
          </div>
          <h2>
            {register
              ? "Create your account"
              : reviewer
                ? "Reviewer workspace"
                : "Welcome back"}
          </h2>
          <p>
            {register
              ? "Start your warranty claim with confidence."
              : reviewer
                ? "Sign in with your provisioned reviewer account."
                : "Sign in to manage your warranty claims."}
          </p>
          <ErrorBox error={error} />
          <form onSubmit={submit}>
            {register && (
              <label>
                Full name
                <input
                  name="name"
                  required
                  minLength={2}
                  maxLength={100}
                  autoComplete="name"
                />
              </label>
            )}
            <label>
              Email address
              <input name="email" type="email" required autoComplete="email" />
            </label>
            <label>
              Password
              <input
                name="password"
                type="password"
                required
                minLength={12}
                maxLength={128}
                autoComplete={register ? "new-password" : "current-password"}
              />
            </label>
            <small>Use at least 12 characters.</small>
            <button className="button full" disabled={busy}>
              {busy ? "Please wait…" : register ? "Create account" : "Sign in"}
              <ArrowRight size={17} />
            </button>
          </form>
          {!reviewer && (
            <p className="auth-switch">
              {register ? "Already have an account?" : "New to ClaimShield?"}{" "}
              <Link to={register ? "/login" : "/register"}>
                {register ? "Sign in" : "Create an account"}
              </Link>
            </p>
          )}
          {reviewer && (
            <p className="muted">
              Reviewer accounts are provisioned by the system operator.
            </p>
          )}
        </div>
      </main>
    </div>
  );
}
function Protected({ children, role }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="loading">Loading your workspace…</div>;
  if (!user)
    return <Navigate to={role === "reviewer" ? "/reviewer/login" : "/login"} />;
  if (role && role !== user.role)
    return (
      <Navigate to={homeFor(user)} />
    );
  return children;
}
function Shell({ children }) {
  const { user, logout } = useAuth();
  const [error, setError] = useState("");
  const reviewer = ["reviewer","company_reviewer"].includes(user.role);
  return (
    <div className="workspace">
      <aside className="sidebar">
        <Logo />
        <div className="workspace-label">
          {user.role === "company_reviewer" ? `${user.company_brand.toUpperCase()} COMPANY WORKSPACE` : reviewer ? "REVIEWER WORKSPACE" : "CUSTOMER WORKSPACE"}
        </div>
        <nav>
          {user.role === "company_reviewer" ? <NavLink to={homeFor(user)}><LayoutDashboard size={18}/>Company claims</NavLink> : <>
          <NavLink to={reviewer ? "/reviewer/device-checks" : "/verify"}>
            <ScanLine size={18} />
            {reviewer ? "Photo review" : "Verify a photo"}
          </NavLink>
          <NavLink end to={reviewer ? "/reviewer" : "/dashboard"}>
            <LayoutDashboard size={18} />
            Overview
          </NavLink>
          {reviewer ? (
            <NavLink to="/reviewer/queue">
              <ClipboardList size={18} />
              Claim queue
            </NavLink>
          ) : (
            <NavLink to="/claims/new">
              <Plus size={18} />
              New claim
            </NavLink>
          )}
          {!reviewer && (
            <NavLink to="/customer/chat">
              <ClipboardList size={18} />
              Guided assistant
            </NavLink>
          )}
          </>}
        </nav>
        <div className="sidebar-note">
          <ShieldCheck size={22} />
          <strong>A fair review, every time.</strong>
          <p>Recommendations support reviewers. People decide.</p>
        </div>
        <div className="profile">
          <span className="avatar">{user.name.slice(0, 1)}</span>
          <div>
            <strong>{user.name}</strong>
            <small>{user.role}</small>
          </div>
          <button
            className="icon-button"
            aria-label="Sign out"
            onClick={() => logout().catch((e) => setError(e.message))}
          >
            <LogOut size={17} />
          </button>
        </div>
      </aside>
      <div className="workspace-main">
        <header className="topbar">
          <span>
            Workspace <ChevronRight size={14} />{" "}
            {reviewer ? "Warranty operations" : "My warranty claims"}
          </span>
          <span className="secure">
            <LockKeyhole size={13} /> Secure workspace
          </span>
        </header>
        <main className="content">
          <ErrorBox error={error} />
          {children}
        </main>
        <footer>
          ClaimShield AI <span>Evidence informs. People decide.</span>
        </footer>
      </div>
    </div>
  );
}
function ClaimTable({ claims, reviewer }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Product / claim</th>
            {reviewer && <th>Customer</th>}
            <th>Submitted</th>
            <th>{reviewer ? "Human review status" : "Claim status"}</th>
            {reviewer && <th>Recommendation</th>}
            <th aria-label="Open" />
          </tr>
        </thead>
        <tbody>
          {claims.map((c) => (
            <tr key={c.id}>
              <td>
                <Link className="product-link" to={"/claims/" + c.id}>
                  <span className="table-icon">
                    <FileCheck2 size={19} />
                  </span>
                  <span>
                    <strong>{c.product}</strong>
                    <small>
                      {c.id.slice(0, 8)} {c.synthetic ? "· SYNTHETIC" : ""}
                    </small>
                  </span>
                </Link>
              </td>
              {reviewer && <td>{c.customer_name}</td>}
              <td>{date(c.created_at)}</td>
              <td>
                <Badge value={c.status} text={!reviewer ? ({SUBMITTED:"Awaiting review",UNDER_REVIEW:"Under review",NEEDS_EVIDENCE:"Action needed",APPROVED:"Approved",REJECTED:"Not approved"}[c.status]) : undefined} />
              </td>
              {reviewer && (
                <td>
                  <Badge value={c.recommendation || "UNKNOWN"} />
                  <small className="queue-version">
                    Engine {c.recommendation_engine || "legacy"}
                  </small>
                </td>
              )}
              <td>
                <Link aria-label={"Open claim " + c.id} to={"/claims/" + c.id}>
                  <ArrowUpRight size={18} />
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function Dashboard({ reviewer = false, queue = false }) {
  const [data, setData] = useState(null),
    [error, setError] = useState(""),
    [search, setSearch] = useState(""),
    [filter, setFilter] = useState("ALL");
  const { user } = useAuth();
  useEffect(() => {
    api(reviewer ? "/reviewer/claims" : "/claims")
      .then(setData)
      .catch((e) => setError(e.message));
  }, [reviewer]);
  const claims = data?.claims || [];
  const shown = claims.filter(
    (c) =>
      (filter === "ALL" || c.status === filter) &&
      `${c.product} ${c.id} ${c.serial} ${c.customer_name || ""}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  return (
    <>
      <LiveInvitations/> 
      <div className="page-heading">
        <div>
          <div className="eyebrow">
            {reviewer ? "WARRANTY OPERATIONS" : "YOUR WARRANTY WORKSPACE"}
          </div>
          <h1>
            {queue
              ? "Claim queue"
              : reviewer
                ? "Review with confidence."
                : `Hello, ${user.name.split(" ")[0]}.`}
          </h1>
          <p>
            {reviewer
              ? "A clear view of every claim that needs your attention."
              : "All your claims, documents, and updates in one place."}
          </p>
        </div>
        {!reviewer && (
          <Link className="button" to="/claims/new">
            <Plus size={17} /> Submit a claim
          </Link>
        )}
      </div>
      <ErrorBox error={error} />
      <div className="stats">
        {[
          [ClipboardList, "Total claims", claims.length],
          [
            Clock,
            "Awaiting review",
            claims.filter((c) =>
              ["SUBMITTED", "UNDER_REVIEW"].includes(c.status),
            ).length,
          ],
          [
            Upload,
            "Needs evidence",
            claims.filter((c) => c.status === "NEEDS_EVIDENCE").length,
          ],
          [
            ShieldCheck,
            "Approved",
            claims.filter((c) => c.status === "APPROVED").length,
          ],
        ].map(([Icon, title, n]) => (
          <div className="stat" key={title}>
            <div>
              <span>{title}</span>
              <Icon size={19} />
            </div>
            <strong>{data ? n : "—"}</strong>
          </div>
        ))}
      </div>
      <div className="info-banner">
        <span className="icon-box">
          <ShieldCheck size={23} />
        </span>
        <div>
          <strong>
            {reviewer
              ? "Every recommendation is a starting point."
              : "A little evidence goes a long way."}
          </strong>
          <p>
            {reviewer
              ? "Check the evidence and rule explanations before recording your decision. Synthetic claims are labeled throughout."
              : "Add your invoice and a clear product photo to help your reviewer assess your claim."}
          </p>
        </div>
        {!reviewer && (
          <Link to="/claims/new">
            <ArrowRight size={20} />
          </Link>
        )}
      </div>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>{reviewer ? "Claim queue" : "Your claims"}</h2>
            <p>
              {reviewer
                ? "Submitted claims and their current review status."
                : "Follow the progress of your warranty requests."}
            </p>
          </div>
          <span className="count">{claims.length} claims</span>
        </div>
        <div className="filters">
          <div className="search">
            <Search size={17} />
            <input
              aria-label="Search claims"
              placeholder="Search product, serial, or claim ID…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <select
            aria-label="Filter by status"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            {[
              "ALL",
              "SUBMITTED",
              "UNDER_REVIEW",
              "NEEDS_EVIDENCE",
              "APPROVED",
              "REJECTED",
            ].map((s) => (
              <option key={s} value={s}>
                {s === "ALL" ? "All statuses" : label(s)}
              </option>
            ))}
          </select>
        </div>
        {!data && !error ? (
          <div className="empty">Loading claims…</div>
        ) : shown.length ? (
          <ClaimTable claims={shown} reviewer={reviewer} />
        ) : (
          <div className="empty">
            <FileCheck2 size={34} />
            <h3>
              {claims.length
                ? "No matching claims"
                : "Your first claim starts here."}
            </h3>
            <p>
              {claims.length
                ? "Try another search or status."
                : "Submit your product details, then securely add your evidence."}
            </p>
            {!reviewer && (
              <Link className="text-link" to="/claims/new">
                Create a claim <ArrowRight size={16} />
              </Link>
            )}
          </div>
        )}
      </section>
      {reviewer &&
        data?.datasets.map((d) => (
          <div className="dataset-note" key={d.id}>
            <strong>Open Repair Alliance · {d.status}</strong>
            <span>
              {" "}
              {d.record_count} aggregate context records · {d.license}. Never
              individual warranty history.
            </span>
          </div>
        ))}
    </>
  );
}
function NewClaim() {
  return <GuidedClaim />;
}
function ClaimDetail() {
  const { id } = useParams();
  const location = useLocation();
  const { user } = useAuth();
  const [data, setData] = useState(null),
    [error, setError] = useState(location.state?.uploadError || ""),
    [success, setSuccess] = useState(""),
    [busy, setBusy] = useState(false);
  const reload = () => api("/claims/" + id).then(setData);
  useEffect(() => {
    setData(null);
    reload().catch((e) => setError(e.message));
    let active=true;
    const timer=setInterval(()=>api('/claims/'+id).then(d=>{if(active)setData(d);}).catch(()=>{}),10000);
    return ()=>{active=false;clearInterval(timer);};
  }, [id]);
  async function decide(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      await api("/reviewer/claims/" + id, {
        method: "PATCH",
        body: Object.fromEntries(new FormData(e.currentTarget)),
      });
      await reload();
      setSuccess("Reviewer decision recorded.");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  if (!data)
    return (
      <>
        <ErrorBox error={error} />
        {!error && <div className="loading">Loading claim…</div>}
      </>
    );
  const { claim: c, investigation: i, evidence, timeline } = data;
  const currentPhoto = evidence.find(
    (e) => e.kind === "photo" && e.active !== 0,
  );
  const closed = ["APPROVED", "REJECTED"].includes(c.status);
  const reviewer = ["reviewer","company_reviewer"].includes(user.role);
  return (
    <>
      <Link
        className="quiet"
        to={user.role === "company_reviewer" ? homeFor(user) : reviewer ? "/reviewer/queue" : "/dashboard"}
      >
        ← Back to claims
      </Link>
      <div className="page-heading">
        <div>
          <div className="eyebrow">
            CLAIM / {c.id.slice(0, 8)} {c.synthetic ? " / SYNTHETIC" : ""}
          </div>
          <h1>{c.model || c.product}</h1>
          <p>
            Submitted {date(c.created_at)}{reviewer && <> · Serial {c.serial}</>}
          </p>
        </div>
        <Badge value={c.is_draft ? "DRAFT" : c.status} />
      </div>
      <ErrorBox error={error} />
      {success && (
        <div role="status" className="success">
          {success}
        </div>
      )}
      {!!c.is_draft && (
        <div className="info-banner">
          Private assistant draft. Return to the guided assistant to confirm and
          submit.
        </div>
      )}
      {!!c.synthetic && (
        <div className="info-banner">
          SYNTHETIC demonstration record. Simulated observations exercise the
          rules and workflow.
        </div>
      )}
      {!reviewer && <CustomerClaimStatus summary={data.customer_summary} />}
      {user.role === "company_reviewer" && <section className="panel detail-panel"><h2>Customer complaint · manual company review</h2><p><strong>Customer:</strong> {data.customer?.name || "Customer"}</p><p><strong>Product:</strong> {c.model || c.product}</p><h3>Customer’s complaint</h3><p className="statement">{c.statement}</p><p>Check the customer’s description, photos and documents below. Choose your decision and provide a reason. Submitting a complaint or receiving an AI recommendation does not approve it.</p></section>}
      {reviewer && !c.is_draft && <ManualDecision onSubmit={decide} busy={busy} closed={closed} status={c.status}/>}
      <section className="panel decision-history"><h2>Human decision & status history</h2><p>Current status: <strong>{c.status.replaceAll('_',' ')}</strong>. AI recommendations are advisory.</p>
      {data.decision_history?.length ? <ol>{data.decision_history.map(d=><li key={d.id}><strong>{d.status.replaceAll('_',' ')}</strong><p>{d.reason || "No reason recorded"}</p><small>{d.actor_name || "Reviewer"} · {d.created_at} UTC</small></li>)}</ol> : <p>No reason recorded</p>}</section>
      {!c.is_draft && (user.role === "customer" || user.role === "company_reviewer") && <LiveAppointment claimId={id} company={user.role === "company_reviewer"} closed={closed} onSaved={reload}/>}

      <div className={"detail-grid" + (!reviewer ? " customer-claim-layout" : "")}>
        <div>
          <details open={reviewer} className="panel detail-panel claim-personal-details">
            <summary>{reviewer ? "Claim details" : "View your claim details"}</summary>
            <dl>
              {c.model && (
                <div>
                  <dt>Model</dt>
                  <dd>{c.model}</dd>
                </div>
              )}
              <div>
                <dt>Purchase date</dt>
                <dd>{c.purchase_date}</dd>
              </div>
              <div>
                <dt>Incident date</dt>
                <dd>{c.incident_date}</dd>
              </div>
              <div>
                <dt>Previous repairs</dt>
                <dd>
                  {c.questionnaire_json
                    ? JSON.parse(c.questionnaire_json).repairs
                    : c.previous_repairs}
                </dd>
              </div>
            </dl>
            {user.role !== "company_reviewer" && <Link
              className="text-link"
              to={
                reviewer
                  ? "/reviewer/device-checks"
                  : `/verify?claimId=${c.id}`
              }
            >
              {reviewer
                ? "Review one-image verification results →"
                : "Verify one product photo for this claim →"}
            </Link>}
            <h3>Customer statement</h3>
            <p className="statement">{c.statement}</p>
            {c.questionnaire_json && (
              <details className="panel">
                <summary>Customer-reported questionnaire · unverified</summary>
                <dl>
                  {Object.entries(JSON.parse(c.questionnaire_json))
                    .filter(([key]) => key !== "version")
                    .map(([key, value]) => (
                      <div key={key}>
                        <dt>{key.replaceAll("_", " ")}</dt>
                        <dd>
                          {typeof value === "object"
                            ? Object.entries(value)
                                .map(([k, v]) => `${k}: ${v}`)
                                .join("; ") || "None supplied"
                            : value || "Unknown"}
                        </dd>
                      </div>
                    ))}
                </dl>
              </details>
            )}
          </details>
          <section id="claim-evidence" className="panel detail-panel">
            <div className="section-title">
              <h2>{reviewer ? "Supporting evidence" : "Your photos & documents"}</h2>
              <span className="count">{evidence.length} files</span>
            </div>
            {evidence.length ? (
              evidence.map((e) => (
                <EvidenceAnalysis
                  key={e.id}
                  claimId={id}
                  evidence={e}
                  closed={closed}
                  reviewer={reviewer}
                  selectedModel={c.model}
                  onChanged={reload}
                />
              ))
            ) : (
              <p className="muted">
                No evidence uploaded yet. Missing evidence does not imply
                misconduct.
              </p>
            )}
            {!closed && (
              <div id="evidence-upload"><EvidenceUpload
                key={id}
                claimId={id}
                kind={
                  currentPhoto && user.role === "customer" ? "photo" : "invoice"
                }
                currentPhoto={currentPhoto}
                selectedModel={c.model}
                allowReplacement={user.role === "customer"}
                includeDocuments
                onUploaded={reload}
              /></div>
            )}
          </section>
          <details open={reviewer} className="customer-review-details"><summary>Detailed investigation record</summary>
          <EvidenceLedger
            claimId={id}
            refreshKey={i?.id}
            closed={closed}
            reviewer={user.role === "reviewer"}
            onChanged={reload}
          />
          </details>
          <details id="claim-history" open={reviewer} className="panel detail-panel claim-personal-details">
            <summary>Claim updates & reviewer notes</summary>
            {timeline.map((t, n) => (
              <div className="timeline" key={n}>
                <span className="timeline-dot" />
                <div>
                  <strong>{label(t.action)}</strong>
                  <p>{t.detail}</p>
                  <small>{date(t.created_at)}</small>
                </div>
              </div>
            ))}
          </details>
        </div>
        {reviewer && <div>
          <section className="panel detail-panel">
            <span className="eyebrow">DETERMINISTIC INVESTIGATION</span>
            <h2>AI recommendation · advisory</h2>
            {i && (
              <>
                <Badge value={i.outcome} />
                <p>{i.explanation}</p>
                <small>
                  Engine {i.engineVersion} · {i.created_at} UTC
                </small>
                <p className="muted">
                  Advisory only. An authorized reviewer makes the final
                  decision.
                </p>
                {i.results.map((r) => (
                  <div className="rule" key={r.ruleId}>
                    <div>
                      <strong>{r.ruleId}</strong>
                      <Badge value={r.status} />
                    </div>
                    <p>{r.explanation}</p>
                    {r.evidenceIds.length > 0 && (
                      <small>
                        Evidence:{" "}
                        {r.evidenceIds.map((e) => e.slice(0, 8)).join(", ")}
                      </small>
                    )}
                  </div>
                ))}
              </>
            )}
          </section>
          <div className="dataset-note">
            <strong>AI adapter: {data.ai.status}</strong>
            <p>
              Analysis runs only when requested. Validated extractions are
              unverified until confirmed by an authorized reviewer.
              Deterministic recommendations and final decisions are never
              overridden by AI.
            </p>
          </div>

        </div>}
      </div>
    </>
  );
}
const inside = (page, role) => (
  <Protected role={role}>
    <Shell>{page}</Shell>
  </Protected>
);
export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/company" element={<main className="company-login"><h1>Company Login</h1><Link className="button" to="/company/samsung/login">Samsung staff</Link><Link className="button secondary" to="/company/boat/login">boAt staff</Link></main>}/>
      <Route path="/company/:brand/login" element={<CompanyLogin/>}/>
      <Route path="/company/:brand" element={<CompanyGate><Shell><CompanyDashboard/></Shell></CompanyGate>}/>
      <Route path="/company/:brand/claims/:id" element={<CompanyGate><Shell><ClaimDetail/></Shell></CompanyGate>}/>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Login register />} />
      <Route path="/reviewer/login" element={<Login reviewer />} />
      <Route path="/dashboard" element={inside(<Dashboard />, "customer")} />
      <Route
        path="/customer/chat"
        element={inside(<InvestigatorChat />, "customer")}
      />
      <Route path="/verify" element={inside(<VerifyDevice />, "customer")} />
      <Route
        path="/reviewer/device-checks"
        element={inside(<VerifyDevice reviewer />, "reviewer")}
      />
      <Route path="/claims/new" element={inside(<NewClaim />, "customer")} />
      <Route path="/claims/:id" element={inside(<ClaimDetail />)} />
      <Route
        path="/reviewer"
        element={inside(<Dashboard reviewer />, "reviewer")}
      />
      <Route
        path="/reviewer/queue"
        element={inside(<Dashboard reviewer queue />, "reviewer")}
      />
      <Route
        path="*"
        element={
          <div className="empty">
            <h1>Page not found</h1>
            <Link className="button" to="/">
              Return home
            </Link>
          </div>
        }
      />
    </Routes>
  );
}
