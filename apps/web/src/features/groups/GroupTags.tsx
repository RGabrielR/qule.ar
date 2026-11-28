import { GROUP_TAG_SECTIONS } from "@mortero/shared/groupTags";
import { useState } from "react";
import { DialogFocus } from "../../components/DialogFocus";
import { useSheetExit } from "../../components/useSheetExit";

type Selection = { tags: string[]; onChange: (tags: string[]) => void };

function TagOptions({ tags, onChange }: Selection) {
  return (
    <div className="form">
      {GROUP_TAG_SECTIONS.map((section) => (
        <fieldset className="field" key={section.label}>
          <legend>{section.label}</legend>
          <div className="chips">
            {section.tags.map((tag) => {
              const selected = tags.includes(tag);
              return (
                <button type="button" className={selected ? "chip chip--on" : "chip"} key={tag} aria-pressed={selected}
                  onClick={() => onChange(selected ? tags.filter((value) => value !== tag) : [...tags, tag])}>
                  {tag}
                </button>
              );
            })}
          </div>
        </fieldset>
      ))}
    </div>
  );
}

export function GroupTagList({ tags }: { tags?: string[] }) {
  return tags?.length ? <p className="group-tags muted small">{tags.join(" ")}</p> : null;
}

export function GroupTagEditor({ tags, onChange }: Selection) {
  return (
    <details className="group-tags-editor">
      <summary>Etiquetas del grupo</summary>
      <GroupTagList tags={tags} />
      <TagOptions tags={tags} onChange={onChange} />
    </details>
  );
}

export function GroupTagFilter({ initial, onApply, onClose }: {
  initial: string[];
  onApply: (tags: string[]) => void;
  onClose: () => void;
}) {
  const [tags, setTags] = useState(initial);
  const { close, backdrop } = useSheetExit(onClose);
  return (
    <div className="sheet-backdrop" {...backdrop}>
      <div className="sheet sheet--tall" role="dialog" aria-modal aria-labelledby="group-tag-title" onClick={(e) => e.stopPropagation()}>
        <DialogFocus onClose={close} />
        <div className="sheet__head">
          <h2 id="group-tag-title">Filtrar por etiquetas</h2>
          <button type="button" className="linkbtn" onClick={() => setTags([])}>Limpiar</button>
        </div>
        <div className="sheet__body form">
          <p className="muted small">Los grupos tienen que incluir todas las etiquetas que elijas.</p>
          <TagOptions tags={tags} onChange={setTags} />
        </div>
        <div className="row sheet__foot">
          <button type="button" className="btn" onClick={() => close()}>Cancelar</button>
          <button type="button" className="btn btn--primary" onClick={() => close(() => onApply(tags))}>Aplicar</button>
        </div>
      </div>
    </div>
  );
}
