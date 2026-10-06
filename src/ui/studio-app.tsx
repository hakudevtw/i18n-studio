import { useEffect, useMemo, useState } from "preact/hooks";
import type { Model, UiLocale } from "../model";
import { fetchModel } from "./api";
import { makeT, resolveLocale } from "./i18n";
import { readRemembered, remember } from "./remember";
import { Report } from "./report";

/** Static report: the model is embedded. Studio: fetch it fresh from the server. */
const loadModel = async (): Promise<Model> => {
  const embedded = document.getElementById("data")?.textContent;
  return embedded ? (JSON.parse(embedded) as Model) : await fetchModel();
};

/** `?lang=` > remembered choice (switcher on) > uiLocale > browser language. */
const localeFor = (model: Model | null): UiLocale =>
  resolveLocale({
    query: new URLSearchParams(location.search).get("lang"),
    stored: readRemembered(),
    switcher: model?.languageSwitcher ?? true,
    setting: model?.uiLocale,
    languages: navigator.languages?.length
      ? navigator.languages
      : [navigator.language],
  });

export const App = () => {
  const [model, setModel] = useState<Model | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<UiLocale | null>(null);
  useEffect(() => {
    loadModel().then(setModel, (e: Error) => setError(e.message));
  }, []);
  const locale = chosen ?? localeFor(model);
  const tr = useMemo(() => makeT(locale), [locale]);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = tr.t("title");
  }, [locale, tr]);

  const onLocale = (next: UiLocale) => {
    remember(next);
    setChosen(next);
  };

  if (error) {
    return <div class="empty">{tr.t("loadError", { error })}</div>;
  }
  return model ? (
    <Report
      locale={locale}
      model={model}
      onLocale={onLocale}
      onModel={setModel}
      tr={tr}
    />
  ) : (
    <div class="empty">{tr.t("loading")}</div>
  );
};
