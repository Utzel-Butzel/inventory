import {
  getResources,
  getT,
  initServerI18next,
} from "next-i18next/server";

import i18nConfig from "@/i18n.config";

initServerI18next(i18nConfig);

export { getResources, getT };
