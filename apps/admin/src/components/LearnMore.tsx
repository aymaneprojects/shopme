import { useT } from '../i18n';

/** Centered "Learn more about ..." link under a list, pointing to the project documentation. */
export function LearnMore({ topic }: { topic: string }) {
  const t = useT();
  return <p className="py-5 text-center text-[13px]"><a href="https://github.com/aymaneprojects/shopme#readme" target="_blank" rel="noreferrer" className="text-fg underline-offset-2 hover:underline">{t('qaf.learnMore', { topic })}</a></p>;
}
