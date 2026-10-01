import ReactMarkdown from 'react-markdown';

export function MarkdownPreview({ content }: { content: string }) {
  return (
    <div className="pw-markdown-preview pw-preview">
      <ReactMarkdown
        components={{
          a: (props) => <a {...props} target="_blank" rel="noreferrer" />,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
