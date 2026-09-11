import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { FontAwesomeIcon } from "../../components/Icon";
import { faHouse, faArrowLeft, faTriangleExclamation, faComments } from "@fortawesome/free-solid-svg-icons";
import "./NotFoundPage.scss";

/** Editorial "Hearth" 404 — full-viewport, standalone (no nav/footer chrome).
 *  Theme follows the app's global theme; no per-page toggle. */
export function NotFoundPage() {
  const { t } = useTranslation("common");
  const navigate = useNavigate();

  const goBack = () => {
    if (document.referrer && window.history.length > 1) navigate(-1);
    else navigate("/");
  };

  return (
    <main className="nf">
      <div className="nf__ghost" aria-hidden="true">404</div>

      <a className="nf__brand" href="/" aria-label="Nodevo home">
        <span className="nf__logomark" aria-hidden="true">
          <FontAwesomeIcon icon={faComments} />
        </span>
        <span className="nf__wordmark">Nodevo</span>
      </a>

      <div className="nf__content">
        <span className="nf__eyebrow">
          <FontAwesomeIcon icon={faTriangleExclamation} />
          {t("notFound.eyebrow")}
        </span>
        <h1 className="nf__h1">{t("notFound.title")}</h1>
        <p className="nf__lead">{t("notFound.lead")}</p>
        <div className="nf__actions">
          <a className="nf__btn nf__btn--primary" href="/">
            <FontAwesomeIcon icon={faHouse} /> {t("notFound.home")}
          </a>
          <button className="nf__btn nf__btn--ghost" type="button" onClick={goBack}>
            <FontAwesomeIcon icon={faArrowLeft} /> {t("notFound.back")}
          </button>
        </div>
      </div>

      <footer className="nf__foot">
        <span>{t("notFound.footLabel")}</span>
      </footer>
    </main>
  );
}
