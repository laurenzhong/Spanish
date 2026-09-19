import { describe, expect, it } from "vitest";
import { selectYoutubeRecoveryFormats, verifiedVideoDecode } from "@/src/modules/media/storage/youtube-recovery-formats";
const formats = [
  {format_id:"136",vcodec:"avc1",acodec:"none",width:1280,height:718},
  {format_id:"399-sr",vcodec:"av01",acodec:"none",width:1920,height:1076,format_note:"AI-upscaled"},
  {format_id:"140",vcodec:"none",acodec:"mp4a",language:"es",abr:128},
  {format_id:"141",vcodec:"none",acodec:"mp4a",language:"en",abr:256},
];
describe("authorized YouTube source selection",()=>{
  it("selects highest native resolution and Spanish AAC",()=>{
    expect(selectYoutubeRecoveryFormats({id:"source",duration:120,formats},"source",120).selection).toBe("136+140");
  });
  it("does not downgrade native higher resolution merely to avoid transcoding",()=>{
    expect(selectYoutubeRecoveryFormats({id:"source",duration:120,formats:[...formats,{format_id:"248",vcodec:"vp9",acodec:"none",width:1920,height:1080}]},"source",120).selection).toBe("248+140");
  });
  it("rejects wrong video identity or duration",()=>{
    expect(()=>selectYoutubeRecoveryFormats({id:"other",duration:120,formats},"source",120)).toThrow("MEDIA_SOURCE_IDENTITY_MISMATCH");
    expect(()=>selectYoutubeRecoveryFormats({id:"source",duration:60,formats},"source",120)).toThrow("MEDIA_SOURCE_IDENTITY_MISMATCH");
  });
  it("rejects DRM or absence of Spanish audio",()=>{
    expect(()=>selectYoutubeRecoveryFormats({id:"source",duration:120,formats:formats.map(f=>({...f,has_drm:true}))},"source",120)).toThrow("MEDIA_NATIVE_SPANISH_FORMAT_REQUIRED");
    expect(()=>selectYoutubeRecoveryFormats({id:"source",duration:120,formats:formats.filter(f=>f.language!=="es")},"source",120)).toThrow("MEDIA_NATIVE_SPANISH_FORMAT_REQUIRED");
  });
  it("can explicitly accept an unlabeled audio stream for a database-declared Spanish source",()=>{
    const unlabeled = formats.map((format) => ({ ...format, language: undefined }));
    expect(selectYoutubeRecoveryFormats({id:"source",duration:120,formats:unlabeled},"source",120,true).audioLanguage).toBe("unlabeled-source-es");
  });
  it("requires completed, full-length decode",()=>{
    expect(verifiedVideoDecode("out_time_us=120000000\nprogress=end\n",120)).toBe(120);
    expect(()=>verifiedVideoDecode("out_time_us=50000000\nprogress=end\n",120)).toThrow("MEDIA_DECODE_DURATION_MISMATCH");
    expect(()=>verifiedVideoDecode("out_time_us=120000000\nprogress=continue\n",120)).toThrow("MEDIA_DECODE_DURATION_MISMATCH");
  });
});
