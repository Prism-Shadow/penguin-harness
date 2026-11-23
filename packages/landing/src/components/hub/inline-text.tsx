/**
 * Text from a hub source, whose `backticked` spans are code names (a Skill, a file, a case id), as
 * the sources write them. The span keeps the text's size and face and takes a quiet fill.
 */
export function InlineText({ children }: { children: string }) {
  return (
    <>
      {children.split(/`([^`\n]+)`/).map((part, index) =>
        index % 2 === 1 ? (
          <code key={index} className="rounded bg-gray-100 px-1 font-[inherit] dark:bg-gray-800">
            {part}
          </code>
        ) : (
          part
        ),
      )}
    </>
  );
}
