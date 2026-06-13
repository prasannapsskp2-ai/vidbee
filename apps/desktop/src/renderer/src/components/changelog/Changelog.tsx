import { Badge } from '@renderer/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@renderer/components/ui/card'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import changelogFr from '../../../../../changelogs/CHANGELOG.fr.md?raw'
import changelogEn from '../../../../../changelogs/CHANGELOG.md?raw'
import changelogRu from '../../../../../changelogs/CHANGELOG.ru.md?raw'
import changelogZh from '../../../../../changelogs/CHANGELOG.zh.md?raw'

interface ChangelogEntry {
  version: string
  date: string
  sections: { heading: string; items: string[] }[]
}

const changelogMap: Record<string, string> = {
  en: changelogEn,
  fr: changelogFr,
  ru: changelogRu,
  zh: changelogZh
}

/** Parses a changelog markdown string into structured entries */
function parseChangelog(raw: string): ChangelogEntry[] {
  const entries: ChangelogEntry[] = []
  let current: ChangelogEntry | null = null
  let currentSection: { heading: string; items: string[] } | null = null

  for (const line of raw.split('\n')) {
    const versionMatch = line.match(/^## \[?(v[\d.]+[-\w.]*)\]?.*?(\d{4}-\d{2}-\d{2})/)
    if (versionMatch) {
      current = { version: versionMatch[1], date: versionMatch[2], sections: [] }
      entries.push(current)
      currentSection = null
      continue
    }

    const sectionMatch = line.match(/^### (.+)/)
    if (sectionMatch && current) {
      currentSection = { heading: sectionMatch[1], items: [] }
      current.sections.push(currentSection)
      continue
    }

    const itemMatch = line.match(/^- (.+)/)
    if (itemMatch && currentSection) {
      currentSection.items.push(itemMatch[1])
    }
  }

  return entries
}

/** Resolves the changelog content based on the current UI language */
function getChangelogForLocale(lang: string): string {
  const base = lang.split('-')[0] ?? 'en'
  return changelogMap[lang] ?? changelogMap[base] ?? changelogMap.en
}

/** Displays the changelog with multi-language support and current version badge */
export function Changelog({ appVersion }: { appVersion: string | undefined }) {
  const { t, i18n } = useTranslation()
  const entries = useMemo(
    () => parseChangelog(getChangelogForLocale(i18n.language)),
    [i18n.language]
  )

  const normalizedAppVersion = appVersion ? `v${appVersion.replace(/^v/, '')}` : null

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('about.resources.changelog')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {entries.map((entry) => {
          const isCurrent = normalizedAppVersion === entry.version
          return (
            <div className="relative border-muted border-l-2 pl-4" key={entry.version}>
              <div className="flex flex-wrap items-center gap-2">
                <a
                  className="font-semibold text-base hover:underline"
                  href={`https://github.com/nexmoe/VidBee/releases/tag/${entry.version}`}
                  rel="noreferrer"
                  target="_blank"
                >
                  {entry.version}
                </a>
                <span className="text-muted-foreground text-sm">{entry.date}</span>
                {isCurrent ? (
                  <Badge variant="default">{t('about.changelog.currentVersion')}</Badge>
                ) : null}
              </div>
              {entry.sections.map((section) => (
                <div className="mt-2" key={section.heading}>
                  <p className="font-medium text-muted-foreground text-sm">{section.heading}</p>
                  <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm">
                    {section.items.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}
