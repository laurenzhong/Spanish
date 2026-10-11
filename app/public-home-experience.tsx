import Link from "next/link";
import { preload } from "react-dom";

import PublicHomeJourney from "./public-home-journey";
import { PublicHomeDemo } from "./public-home-demo";
import { PublicHomeNavigation } from "./public-home-navigation";

/**
 * The public home is a product page, not a poster: the headline stays short and
 * quiet, and the real product carries the page — a silent minute of the
 * workbench playing a lesson with the bilingual transcript following along,
 * then a plain list of what the product actually does.
 *
 * The recording is generated, never hand-edited: a Playwright pass over the
 * published item `youtube.language-reactor.f79e84b7ec9030b11c5b3be1`
 * ("El sol de medianoche en Kiruna, Suecia", Luisito Comunica — a whitelisted
 * source), transcript switched to 双语, seeked to 30:55 where the midnight sun
 * appears, then 60 s of real playback. Cut and encoded with
 * `ffmpeg -ss 13.4 -t 60 -vf "crop=1280:686:0:0,fps=24,scale=960:-2" -crf 31
 * -pix_fmt yuv420p -an -movflags +faststart`; the poster is a frame of it.
 */

const demo = {
  video: "/public-home/midnight-sun-kiruna.mp4",
  poster: "/public-home/midnight-sun-kiruna-poster.webp",
};

type Capability = Readonly<{
  title: string;
  detail: string;
  icon: "library" | "captions" | "word" | "mic" | "chart" | "shield";
  /**
   * A real screenshot of the surface this card claims, shown only when the
   * visitor asks for it. Two cards carry one: they are the claims a picture
   * settles better than a sentence, and the rest stay text so the grid does
   * not turn into a gallery.
   */
  shot?: Readonly<{ src: string; width: number; height: number; alt: string; caption: string }>;
}>;

const capabilities: readonly Capability[] = [
  {
    title: "打开就是资料库",
    // "170+" rather than the 172 measured today: the library grows every day the
    // pipeline publishes, and a floor stays true while an exact count goes stale.
    detail: "白名单来源每天增量发现，审核通过才发布；已有 170+ 个视频与播客版本，“学习”打开直接就是它们。",
    icon: "library",
    shot: {
      src: "/public-home/capability-library.webp",
      width: 900,
      height: 586,
      alt: "媒体资料库桌面端截图：搜索框、全部/视频/播客分类，以及带时长与难度的内容卡片网格",
      caption: "桌面端资料库：170+ 个已发布版本按最近收录排列，卡片本身就是入口。",
    },
  },
  {
    title: "逐句字幕跟随",
    detail: "字幕跟着播放走，点任意一句回到那一刻，听不懂变成可定位。",
    icon: "captions",
  },
  {
    title: "生词就地回看",
    detail: "播放中直接查词、存词；查过的词落在一张按参考词频排列的 7,922 词架上。",
    icon: "word",
    shot: {
      src: "/public-home/capability-vocabulary.webp",
      width: 900,
      height: 586,
      alt: "词汇页截图：搜索框、按参考词频排序的词条网格，以及右侧的名次轨",
      caption: "词汇页：7,922 个词条按参考词频排序，右侧是名次轨。",
    },
  },
  {
    title: "说完再纠正",
    detail: "9 个可练场景里都是这个顺序：完整表达之前不打断，低置信度转写不会算成退步。",
    icon: "mic",
  },
  {
    title: "四个能力板块",
    detail: "词汇与短语、交流运用、语音表达、跟读表现分开记录。",
    icon: "chart",
  },
  {
    title: "关系记忆有边界",
    detail: "和 Lucía 的记忆默认只属于这段关系，允许时才共享。",
    icon: "shield",
  },
];

function CapabilityIcon({ name }: Readonly<{ name: Capability["icon"] }>) {
  const common = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  if (name === "library") {
    return <svg {...common}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16M3 9h6" /><path d="m14 12 3 2.5-3 2.5z" /></svg>;
  }
  if (name === "captions") {
    return <svg {...common}><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M7 11h5M7 15h9M15.5 11h1.5" /></svg>;
  }
  if (name === "word") {
    return <svg {...common}><path d="M4 5h7a3 3 0 0 1 3 3v11" /><path d="M20 5h-3a4 4 0 0 0-3 1.5" /><path d="M4 19h5M14 19h6" /></svg>;
  }
  if (name === "mic") {
    return <svg {...common}><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>;
  }
  if (name === "chart") {
    return <svg {...common}><path d="M4 20V6M10 20V10M16 20v-7M22 20H2" /></svg>;
  }
  return <svg {...common}><path d="M12 3 5 6v6c0 4 3 7.5 7 9 4-1.5 7-5 7-9V6z" /><path d="m9.5 12 1.8 1.8 3.4-3.6" /></svg>;
}

export default function PublicHomeExperience() {
  // The poster is the largest paint on the page; start it with the document
  // instead of waiting for the markup to be parsed.
  preload(demo.poster, { as: "image", type: "image/webp", fetchPriority: "high" });

  return (
    <main className="landing-page">
      <div className="landing-top">
        <div className="landing-shell">
          <header className="landing-nav">
            <Link className="landing-wordmark" href="/" aria-label="Sueño 首页">Sue<span>ñ</span>o</Link>
            <PublicHomeNavigation />
            <Link className="landing-nav__cta" href="/login?next=%2Flearn">进入学习</Link>
          </header>

          <section className="landing-hero" aria-labelledby="public-home-title">
            <div className="landing-hero__intro">
              <p className="landing-eyebrow">西语 · 听说优先 · 个人 Alpha</p>
              <h1 id="public-home-title"><span>把认识的<span className="landing-hero__keep">西语</span>，</span><span>变成真正说得出口的话。</span></h1>
              <p className="landing-lede">真实语速的视频和播客，配上逐句字幕与词语回看：先听懂，再把完整意思说出口。</p>
              <div className="landing-hero__actions">
                <Link className="landing-button landing-button--accent" href="/login?next=%2Flearn">进入学习 <span aria-hidden="true">↗</span></Link>
                <a className="landing-text-button" href="#how-it-works">它怎么用 <span aria-hidden="true">↓</span></a>
              </div>
            </div>

            <figure className="landing-demo">
              <PublicHomeDemo
                poster={demo.poster}
                src={demo.video}
                width={960}
                height={514}
                label="产品实录：媒体学习工作台播放《El sol de medianoche en Kiruna, Suecia》，右侧字幕逐句跟随，西班牙语与中文对照"
                fallback={<>你的浏览器不支持内嵌视频，可以<a href={demo.video}>下载这段一分钟的实录</a>。</>}
              />
              <figcaption className="landing-demo__caption">
                <span>真实产品实录 · 约一分钟 · 无声</span>
                {/* The title is Spanish inside a Chinese sentence; the language
                    tag keeps a screen reader from reading it as Chinese. */}
                <span>《<span lang="es">El sol de medianoche en Kiruna, Suecia</span>》· 双语字幕</span>
              </figcaption>
            </figure>
          </section>
        </div>
      </div>

      <div className="landing-shell">
        <section className="landing-capabilities" aria-labelledby="capabilities-title">
          <div className="landing-section-head">
            <h2 id="capabilities-title">里面有什么</h2>
            <p>每一屏都能直接开始，不需要先选模式、时长或目标。</p>
          </div>
          <ul className="landing-cards">
            {capabilities.map((capability) => (
              <li className="landing-card" key={capability.title}>
                <span className="landing-card__icon"><CapabilityIcon name={capability.icon} /></span>
                <h3>{capability.title}</h3>
                <p>{capability.detail}</p>
                {capability.shot ? (
                  <details className="landing-card__more">
                    <summary>看真实界面</summary>
                    {/* eslint-disable-next-line @next/next/no-img-element -- a pre-sized static WebP, below the fold and lazy, so the image optimiser would only add a round trip */}
                    <img
                      src={capability.shot.src}
                      alt={capability.shot.alt}
                      width={capability.shot.width}
                      height={capability.shot.height}
                      loading="lazy"
                      decoding="async"
                    />
                    <p className="landing-card__caption">{capability.shot.caption}</p>
                  </details>
                ) : null}
              </li>
            ))}
          </ul>
        </section>

        <PublicHomeJourney />

        <section className="landing-trust" aria-labelledby="trust-title">
          <div className="landing-section-head">
            <h2 id="trust-title">进步属于你</h2>
            <p>学习时长只画热力图，不参与能力评分；关系记忆默认不共享。</p>
          </div>
          <div className="landing-trust__body">
            <div className="landing-chat">
              <div className="landing-chat__head"><span lang="es">Lucía</span><small>关系记忆 · 只在允许时共享</small></div>
              <div className="landing-chat__message"><span lang="es">Lucía</span><p lang="es">¿Te apetece seguir hablando después?</p><small>18:42</small></div>
              <div className="landing-chat__message is-user"><span>你</span><p lang="es">Sí, me gustaría. Tengo un poco de tiempo.</p><small>18:43</small></div>
            </div>
            <ul className="landing-trust__rules">
              <li><b>mastery / confidence</b><span>掌握度和证据可信度分开记录。</span></li>
              <li><b>技术失败</b><span>低置信度或转写失败不会伪装成退步。</span></li>
              <li><b>记忆隔离</b><span>教学画像不会被当作角色闲聊的资料。</span></li>
            </ul>
          </div>
        </section>

        <section className="landing-closing" aria-labelledby="closing-title">
          <div>
            <h2 id="closing-title">下一句话，从你自己的声音开始。</h2>
            <p>打开就是资料库，选一段顺眼的开始就好。</p>
          </div>
          <Link className="landing-button landing-button--accent" href="/login?next=%2Flearn">进入学习 <span aria-hidden="true">↗</span></Link>
        </section>

        <footer className="landing-footer">
          <Link className="landing-wordmark" href="/" aria-label="Sueño 首页">Sue<span>ñ</span>o</Link>
          <span>把话说出来</span>
          <Link href="/login">登录</Link>
        </footer>
      </div>
    </main>
  );
}
