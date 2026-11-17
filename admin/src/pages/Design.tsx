import { useEffect, useId, useState } from "react";
import { trpc } from "@/providers/trpc";
import { AdminLayout } from "@/components/AdminLayout";
import { ImageUpload } from "@/components/ImageUpload";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DEFAULT_DESIGN,
  DEFAULT_FAVICON_URL,
  FONT_OPTIONS,
  type DesignColors,
  type DesignSettings,
} from "@contracts/design";

const selectClass =
  "h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm";

const COLOR_FIELDS: { key: keyof DesignColors; label: string }[] = [
  { key: "background", label: "Основной фон" },
  { key: "surface", label: "Светлая поверхность" },
  { key: "text", label: "Основной текст" },
  { key: "textSoft", label: "Приглушённый текст" },
  { key: "accent", label: "Акцент (бордовый)" },
  { key: "accentDark", label: "Тёмный акцент" },
  { key: "olive", label: "Оливковый" },
  { key: "beige", label: "Бежевый" },
  { key: "card", label: "Фон карточек" },
  { key: "cardText", label: "Текст карточек" },
  { key: "button", label: "Кнопки" },
  { key: "buttonText", label: "Текст кнопок" },
  { key: "link", label: "Ссылки" },
  { key: "header", label: "Фон шапки" },
  { key: "headerText", label: "Текст шапки" },
  { key: "footer", label: "Фон подвала" },
  { key: "footerText", label: "Текст подвала" },
];

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 w-12 shrink-0 cursor-pointer rounded-md border border-input bg-transparent p-1"
        aria-label={label}
      />
      <div className="min-w-0 flex-1">
        <div className="text-xs text-slate-500">{label}</div>
        <Input
          value={value}
          onChange={(e) => {
            const next = e.target.value;
            if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})?$/.test(next))
              onChange(next);
          }}
          className="h-7 text-xs"
          aria-label={`${label}, HEX-значение`}
        />
      </div>
    </div>
  );
}

function Toggle({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}) {
  const hintId = useId();
  return (
    <label className="flex items-start gap-2 text-sm">
      <input
        type="checkbox"
        aria-label={label}
        aria-describedby={hintId}
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4"
      />
      <span>
        {label}
        <span id={hintId} className="block text-xs text-slate-500">
          {hint}
        </span>
      </span>
    </label>
  );
}

function LoginBackgroundSetting() {
  const utils = trpc.useUtils();
  const preference = trpc.adminAppearance.loginBackground.useQuery();
  const update = trpc.adminAppearance.setLoginBackground.useMutation({
    onSuccess: () => utils.adminAppearance.loginBackground.invalidate(),
  });

  return (
    <Card className="mb-4">
      <CardHeader>
        <CardTitle>Фон страницы входа</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-2">
        {preference.data && (
          <Toggle
            label="Анимированный фон"
            hint="При отключении на странице входа будет однотонный фон. Настройка сохраняется сразу."
            checked={preference.data.enabled}
            disabled={update.isPending}
            onChange={(enabled) => update.mutate({ enabled })}
          />
        )}
        {(preference.isPending || update.isPending) && (
          <p role="status" className="text-sm text-slate-500">
            {update.isPending ? "Сохранение…" : "Загрузка настройки…"}
          </p>
        )}
        {(preference.isError || update.isError) && (
          <p role="alert" className="text-sm text-red-800">
            {update.isError
              ? "Не удалось сохранить настройку фона. Попробуйте ещё раз."
              : "Не удалось загрузить настройку фона."}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export default function Design() {
  const { data: content } = trpc.content.get.useQuery();
  const utils = trpc.useUtils();

  const [form, setForm] = useState<DesignSettings | null>(null);
  const [saved, setSaved] = useState(false);
  const [faviconUploading, setFaviconUploading] = useState(false);

  useEffect(() => {
    if (content && !form) setForm(structuredClone(content.design));
  }, [content, form]);

  const updateContent = trpc.content.update.useMutation({
    onSuccess: async () => {
      await utils.content.get.invalidate();
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    },
  });

  const setColor = (key: keyof DesignColors, value: string) =>
    setForm((f) => (f ? { ...f, colors: { ...f.colors, [key]: value } } : f));

  if (!form)
    return (
      <AdminLayout
        title="Дизайн сайта"
        description="Палитра, шрифты и оформление"
      >
        <Card>
          <CardContent className="p-8 text-center text-slate-500">
            Загрузка…
          </CardContent>
        </Card>
      </AdminLayout>
    );

  const hexValid = COLOR_FIELDS.every(({ key }) =>
    /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(form.colors[key]),
  );

  return (
    <AdminLayout
      title="Дизайн сайта"
      description="Цвета, шрифты и оформление витрины. Изменения применяются сразу после сохранения."
      actions={
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() =>
              setForm({
                ...structuredClone(DEFAULT_DESIGN),
                faviconImage: form.faviconImage,
              })
            }
          >
            Сбросить к палитре по умолчанию
          </Button>
          <Button
            onClick={() => updateContent.mutate({ design: form })}
            disabled={!hexValid || faviconUploading || updateContent.isPending}
          >
            {updateContent.isPending ? "Сохранение…" : "Сохранить дизайн"}
          </Button>
        </div>
      }
    >
      {saved && (
        <div className="mb-4 px-3 py-2 rounded-md bg-green-50 border border-green-200 text-sm text-green-800">
          Дизайн сохранён
        </div>
      )}
      {updateContent.error && (
        <div className="mb-4 px-3 py-2 rounded-md bg-red-50 border border-red-200 text-sm text-red-800">
          {updateContent.error.message}
        </div>
      )}
      {!hexValid && (
        <div className="mb-4 px-3 py-2 rounded-md bg-amber-50 border border-amber-200 text-sm text-amber-800">
          Не все цвета заполнены — ожидается HEX-формат, например #831C25.
        </div>
      )}

      <Card className="mb-4">
        <CardHeader>
          <CardTitle>Фавикон сайта</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-slate-500">
            Значок во вкладке браузера. Загрузите квадратное изображение PNG,
            JPEG или WebP и нажмите «Сохранить дизайн».
          </p>
          <img
            src={form.faviconImage || DEFAULT_FAVICON_URL}
            width={48}
            height={48}
            className="h-12 w-12 object-contain"
            alt="Предпросмотр фавикона"
          />
          <ImageUpload
            onBusyChange={setFaviconUploading}
            onUpload={(faviconImage) =>
              setForm((current) => current && { ...current, faviconImage })
            }
          />
          {form.faviconImage && (
            <Button
              variant="outline"
              disabled={faviconUploading || updateContent.isPending}
              onClick={() => setForm({ ...form, faviconImage: "" })}
            >
              Вернуть стандартный фавикон
            </Button>
          )}
        </CardContent>
      </Card>
      <LoginBackgroundSetting />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Цветовая палитра</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            {COLOR_FIELDS.map(({ key, label }) => (
              <ColorField
                key={key}
                label={label}
                value={form.colors[key]}
                onChange={(value) => setColor(key, value)}
              />
            ))}
          </CardContent>
        </Card>

        <div className="grid gap-4 content-start">
          <Card>
            <CardHeader>
              <CardTitle>Шрифты</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3">
              <div>
                <Label>Заголовки</Label>
                <select
                  className={selectClass}
                  value={form.fonts.heading}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      fonts: {
                        ...form.fonts,
                        heading: e.target
                          .value as DesignSettings["fonts"]["heading"],
                      },
                    })
                  }
                >
                  {FONT_OPTIONS.map((option) => (
                    <option key={option.key} value={option.key}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label>Основной текст</Label>
                <select
                  className={selectClass}
                  value={form.fonts.body}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      fonts: {
                        ...form.fonts,
                        body: e.target.value as DesignSettings["fonts"]["body"],
                      },
                    })
                  }
                >
                  {FONT_OPTIONS.map((option) => (
                    <option key={option.key} value={option.key}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Форма и плотность</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div>
                <Label>Скругление карточек и кнопок: {form.radius}px</Label>
                <input
                  type="range"
                  min={0}
                  max={40}
                  value={form.radius}
                  onChange={(e) =>
                    setForm({ ...form, radius: Number(e.target.value) })
                  }
                  className="w-full"
                  aria-label="Скругление"
                />
              </div>
              <div>
                <Label>Плотность компоновки</Label>
                <select
                  className={selectClass}
                  value={form.density}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      density: e.target.value as DesignSettings["density"],
                    })
                  }
                >
                  <option value="compact">Компактная</option>
                  <option value="normal">Обычная</option>
                  <option value="airy">Воздушная</option>
                </select>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Шапка и декор</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3">
              <Toggle
                label="Прилипающая шапка"
                hint="Шапка остаётся сверху при прокрутке страницы"
                checked={form.headerSticky}
                onChange={(headerSticky) => setForm({ ...form, headerSticky })}
              />
              <Toggle
                label="Арочные фотографии"
                hint="Крупные скругления и арочные края снимков"
                checked={form.archPhotos}
                onChange={(archPhotos) => setForm({ ...form, archPhotos })}
              />
              <Toggle
                label="Декоративные ветви"
                hint="Мягкие силуэты листвы поверх фотографий"
                checked={form.decorLeaves}
                onChange={(decorLeaves) => setForm({ ...form, decorLeaves })}
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </AdminLayout>
  );
}
