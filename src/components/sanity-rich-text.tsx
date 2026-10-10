import { PortableText, type PortableTextComponents } from '@portabletext/react'

import { publicSiteUrl } from '@/lib/contentReviews/view'

/**
 * Portable Text as the public site draws it (`components/SanityRichText.tsx`
 * in alphamd): the same block styles, lists, marks and tables, so a reviewer
 * reads the page's words in the page's structure.
 */
const components: PortableTextComponents = {
  block: {
    normal: ({ children }) => <p className="mb-4">{children}</p>,
    h1: ({ children }) => <h1 className="mb-4 text-3xl font-bold">{children}</h1>,
    h2: ({ children }) => <h2 className="mb-4 text-2xl font-bold">{children}</h2>,
    h3: ({ children }) => <h3 className="mb-4 text-xl font-bold">{children}</h3>,
    h4: ({ children }) => <h4 className="mb-4 text-lg font-bold">{children}</h4>,
    blockquote: ({ children }) => (
      <blockquote className="my-4 border-l-4 border-gray-300 pl-4 italic">{children}</blockquote>
    ),
  },
  types: {
    horizontalRule: () => <hr className="my-8 border-t border-gray-300" />,
    table: ({ value }: { value: { rows?: { cells?: { content?: unknown[] }[] }[] } }) => (
      <div className="my-4 overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <tbody className="divide-y divide-gray-200">
            {(value.rows ?? []).map((row, rowIndex) => (
              <tr key={rowIndex}>
                {(row.cells ?? []).map((cell, cellIndex) => (
                  <td
                    key={cellIndex}
                    className={`px-4 py-2 align-top ${rowIndex === 0 ? 'font-semibold' : ''}`}
                  >
                    <SanityRichText blocks={cell.content ?? []} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    ),
  },
  list: {
    bullet: ({ children }) => <ul className="mb-4 list-disc pl-6">{children}</ul>,
    number: ({ children }) => <ol className="mb-4 list-decimal pl-6">{children}</ol>,
  },
  listItem: {
    bullet: ({ children }) => <li className="mb-2">{children}</li>,
    number: ({ children }) => <li className="mb-2">{children}</li>,
  },
  marks: {
    strong: ({ children }) => <strong className="font-bold">{children}</strong>,
    em: ({ children }) => <em className="italic">{children}</em>,
    link: ({ value, children }) => (
      <a
        href={value?.href ? publicSiteUrl(value.href) : undefined}
        target="_blank"
        rel="noopener noreferrer"
        className="text-blue-600 underline"
      >
        {children}
      </a>
    ),
  },
}

export function SanityRichText({ blocks }: { blocks: unknown[] }) {
  return (
    <PortableText
      value={blocks as Parameters<typeof PortableText>[0]['value']}
      components={components}
      onMissingComponent={false}
    />
  )
}
