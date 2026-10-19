import { Embed, Sourcerer } from '@/providers/base';
import { doodScraper } from '@/providers/embeds/dood';
import { filemoonScraper } from '@/providers/embeds/filemoon';
import { mixdropScraper } from '@/providers/embeds/mixdrop';
import { serverMirrorEmbed } from '@/providers/embeds/server-mirrors';
import { turbovidScraper } from '@/providers/embeds/turbovid';
import { upcloudScraper } from '@/providers/embeds/upcloud';
import { autoembedScraper } from '@/providers/sources/autoembed';
import { ee3Scraper } from '@/providers/sources/ee3';
import { fsharetvScraper } from '@/providers/sources/fsharetv';
import { insertunitScraper } from '@/providers/sources/insertunit';
import { mp4hydraScraper } from '@/providers/sources/mp4hydra';
import { nepuScraper } from '@/providers/sources/nepu';
import { pirxcyScraper } from '@/providers/sources/pirxcy';
import { tugaflixScraper } from '@/providers/sources/tugaflix';
import { vidsrcScraper } from '@/providers/sources/vidsrc';
import { vidsrcvipScraper } from '@/providers/sources/vidsrcvip';
import { zoechipScraper } from '@/providers/sources/zoechip';

import { AnimetsuEmbeds } from './embeds/animetsu';
import {
  autoembedBengaliScraper,
  autoembedEnglishScraper,
  autoembedHindiScraper,
  autoembedTamilScraper,
  autoembedTeluguScraper,
} from './embeds/autoembed';
import { cinemaosEmbeds } from './embeds/cinemaos';
import { closeLoadScraper } from './embeds/closeload';
import { droploadScraper } from './embeds/dropload';
import { filelionsScraper } from './embeds/filelions';
import { indavideoScraper } from './embeds/indavideo';
import { madplayBaseEmbed, madplayNsapiEmbed, madplayNsapiVidFastEmbed, madplayRoperEmbed } from './embeds/madplay';
import { mp4hydraServer1Scraper, mp4hydraServer2Scraper } from './embeds/mp4hydra';
import { myanimedubScraper } from './embeds/myanimedub';
import { myanimesubScraper } from './embeds/myanimesub';
import { ridooScraper } from './embeds/ridoo';
import { rubyvidScraper } from './embeds/rubyvid';
import { rpmshareScraper } from './embeds/rpmshare';
import { okruScraper } from './embeds/okru';
import { vkScraper } from './embeds/vk';
import { fsstScraper } from './embeds/fsst';
import { streamtapeLatinoScraper, streamtapeScraper } from './embeds/streamtape';
import { streamvidScraper } from './embeds/streamvid';
import {
  streamwishEnglishScraper,
  streamwishJapaneseScraper,
  streamwishLatinoScraper,
  streamwishSpanishScraper,
} from './embeds/streamwish';
import { supervideoScraper } from './embeds/supervideo';
import { vidCloudScraper } from './embeds/vidcloud';
import { vidaraScraper } from './embeds/vidara';
import { videaScraper } from './embeds/videa';
import { vidhideEnglishScraper, vidhideLatinoScraper, vidhideSpanishScraper } from './embeds/vidhide';
import { vidifyEmbeds } from './embeds/vidify';
import { vidmolyScraper } from './embeds/vidmoly';
import {
  vidnestAllmoviesEmbed,
  vidnestFlixhqEmbed,
  vidnestHollymoviehdEmbed,
  vidnestOfficialEmbed,
} from './embeds/vidnest';
import {
  VidsrcsuServer10Scraper,
  VidsrcsuServer11Scraper,
  VidsrcsuServer12Scraper,
  VidsrcsuServer1Scraper,
  VidsrcsuServer20Scraper,
  VidsrcsuServer2Scraper,
  VidsrcsuServer3Scraper,
  VidsrcsuServer4Scraper,
  VidsrcsuServer5Scraper,
  VidsrcsuServer6Scraper,
  VidsrcsuServer7Scraper,
  VidsrcsuServer8Scraper,
  VidsrcsuServer9Scraper,
} from './embeds/vidsrcsu';
import { viperScraper } from './embeds/viper';
import { voeScraper } from './embeds/voe';
import { warezcdnembedHlsScraper } from './embeds/warezcdn/hls';
import { warezcdnembedMp4Scraper } from './embeds/warezcdn/mp4';
import { warezPlayerScraper } from './embeds/warezcdn/warezplayer';
import { zunimeEmbeds } from './embeds/zunime';
import { EightStreamScraper } from './sources/8stream';
import { animeflvScraper } from './sources/animeflv';
import { animetsuScraper } from './sources/animetsu';
import { cinehdplusScraper } from './sources/cinehdplus-es';
import { cinemaosScraper } from './sources/cinemaos';
import { coitusScraper } from './sources/coitus';
import { cuevana3Scraper } from './sources/cuevana3';
import { debridScraper } from './sources/debrid';
import { dmdamediaScraper } from './sources/dmdamedia';
import { embedsuScraper } from './sources/embedsu';
import { hdRezkaScraper } from './sources/hdrezka';
import { iosmirrorScraper } from './sources/iosmirror';
import { iosmirrorPVScraper } from './sources/iosmirrorpv';
import { lookmovieScraper } from './sources/lookmovie';
import { madplayScraper } from './sources/madplay';
import { movies4fScraper } from './sources/movies4f';
import { myanimeScraper } from './sources/myanime';
import { filminvazioScraper } from './sources/filminvazio';
import { filminvazioccScraper } from './sources/filminvaziocc';
import { netmoziScraper } from './sources/netmozi';
import { onlinefilmekingyenScraper } from './sources/onlinefilmekingyen';
import { jobbmintatvScraper } from './sources/jobbmintatv';
import { filmiScraper } from './sources/filmi';
import { hdmoziScraper } from './sources/hdmozi';
import { mozigoScraper } from './sources/mozigo';
import { mozisarokScraper } from './sources/mozisarok';
import { filmezzmoziScraper } from './sources/filmezzmozi';
import { filmdepoScraper } from './sources/filmdepo';
import { mooviedoamScraper } from './sources/mooviedoam';
import { moziboxScraper } from './sources/mozibox';
import { napifilmScraper } from './sources/napifilm';
import { filmsarokScraper } from './sources/filmsarok';
import { mozikatalogusScraper } from './sources/mozikatalogus';
import { sorozatoknetScraper } from './sources/sorozatoknet';
import { filmezekScraper } from './sources/filmezek';
import { sorozatccScraper } from './sources/sorozatcc';
import { onlinefilmvilag2Scraper } from './sources/onlinefilmvilag2';
import { nunflixScraper } from './sources/nunflix';
import { pelisplushdScraper } from './sources/pelisplushd';
import { primewireScraper } from './sources/primewire';
import { rgshowsScraper } from './sources/rgshows';
import { ridooMoviesScraper } from './sources/ridomovies';
import { slidemoviesScraper } from './sources/slidemovies';
import { soaperTvScraper } from './sources/soapertv';
import { streamboxScraper } from './sources/streambox';
import { turbovidSourceScraper } from './sources/turbovid';
import { vidapiClickScraper } from './sources/vidapiclick';
import { vidifyScraper } from './sources/vidify';
import vidnestScraper from './sources/vidnest';
import { warezcdnScraper } from './sources/warezcdn';
import { wecimaScraper } from './sources/wecima';
import { zunimeScraper } from './sources/zunime';

export function gatherAllSources(): Array<Sourcerer> {
  // all sources are gathered here
  const sources: Array<Sourcerer> = [
    cuevana3Scraper,
    ridooMoviesScraper,
    hdRezkaScraper,
    warezcdnScraper,
    insertunitScraper,
    soaperTvScraper,
    autoembedScraper,
    myanimeScraper,
    tugaflixScraper,
    ee3Scraper,
    fsharetvScraper,
    vidsrcScraper,
    zoechipScraper,
    mp4hydraScraper,
    embedsuScraper,
    slidemoviesScraper,
    iosmirrorScraper,
    iosmirrorPVScraper,
    vidapiClickScraper,
    coitusScraper,
    streamboxScraper,
    nunflixScraper,
    EightStreamScraper,
    wecimaScraper,
    animeflvScraper,
    cinemaosScraper,
    nepuScraper,
    pirxcyScraper,
    vidsrcvipScraper,
    madplayScraper,
    rgshowsScraper,
    vidifyScraper,
    zunimeScraper,
    vidnestScraper,
    animetsuScraper,
    lookmovieScraper,
    turbovidSourceScraper,
    pelisplushdScraper,
    primewireScraper,
    movies4fScraper,
    debridScraper,
    cinehdplusScraper,
    netmoziScraper,
    filminvazioScraper,
    filminvazioccScraper,
    dmdamediaScraper,
    onlinefilmekingyenScraper,
    jobbmintatvScraper,
    filmiScraper,
    hdmoziScraper,
    mozigoScraper,
    mozisarokScraper,
    filmezzmoziScraper,
    filmdepoScraper,
    mooviedoamScraper,
    moziboxScraper,
    napifilmScraper,
    filmsarokScraper,
    mozikatalogusScraper,
    sorozatoknetScraper,
    filmezekScraper,
    sorozatccScraper,
    onlinefilmvilag2Scraper,
  ];

  // Temporarily disable all other sources except Hungarian sources
  return sources.map((s) =>
    s.id === 'netmozi' ||
    s.id === 'filminvazio' ||
    s.id === 'filminvaziocc' ||
    s.id === 'dmdamedia' ||
    s.id === 'onlinefilmekingyen' ||
    s.id === 'jobbmintatv' ||
    s.id === 'filmi' ||
    s.id === 'hdmozi' ||
    s.id === 'mozigo' ||
    s.id === 'mozisarok' ||
    s.id === 'filmezzmozi' ||
    s.id === 'filmdepo' ||
    s.id === 'mooviedoam' ||
    s.id === 'mozibox' ||
    s.id === 'napifilm' ||
    s.id === 'filmsarok' ||
    s.id === 'mozikatalogus' ||
    s.id === 'sorozatoknet' ||
    s.id === 'filmezek' ||
    s.id === 'sorozatcc' ||
    s.id === 'onlinefilmvilag2'
      ? s
      : { ...s, disabled: true },
  );
}

export function gatherAllEmbeds(): Array<Embed> {
  // all embeds are gathered here
  return [
    serverMirrorEmbed,
    upcloudScraper,
    vidCloudScraper,
    mixdropScraper,
    ridooScraper,
    closeLoadScraper,
    doodScraper,
    streamvidScraper,
    streamtapeScraper,
    warezcdnembedHlsScraper,
    warezcdnembedMp4Scraper,
    warezPlayerScraper,
    autoembedEnglishScraper,
    autoembedHindiScraper,
    autoembedBengaliScraper,
    autoembedTamilScraper,
    autoembedTeluguScraper,
    turbovidScraper,
    mp4hydraServer1Scraper,
    mp4hydraServer2Scraper,
    VidsrcsuServer1Scraper,
    VidsrcsuServer2Scraper,
    VidsrcsuServer3Scraper,
    VidsrcsuServer4Scraper,
    VidsrcsuServer5Scraper,
    VidsrcsuServer6Scraper,
    VidsrcsuServer7Scraper,
    VidsrcsuServer8Scraper,
    VidsrcsuServer9Scraper,
    VidsrcsuServer10Scraper,
    VidsrcsuServer11Scraper,
    VidsrcsuServer12Scraper,
    VidsrcsuServer20Scraper,
    viperScraper,
    streamwishJapaneseScraper,
    streamwishLatinoScraper,
    streamwishSpanishScraper,
    streamwishEnglishScraper,
    streamtapeLatinoScraper,
    ...cinemaosEmbeds,
    // ...cinemaosHexaEmbeds,
    // vidsrcNovaEmbed,
    // vidsrcCometEmbed,
    // vidsrcPulsarEmbed,
    madplayBaseEmbed,
    madplayNsapiEmbed,
    madplayRoperEmbed,
    madplayNsapiVidFastEmbed,
    ...vidifyEmbeds,
    ...zunimeEmbeds,
    ...AnimetsuEmbeds,
    vidnestHollymoviehdEmbed,
    vidnestAllmoviesEmbed,
    vidnestFlixhqEmbed,
    vidnestOfficialEmbed,
    myanimesubScraper,
    myanimedubScraper,
    filemoonScraper,
    vidhideLatinoScraper,
    vidhideSpanishScraper,
    vidhideEnglishScraper,
    filelionsScraper,
    droploadScraper,
    supervideoScraper,
    videaScraper,
    indavideoScraper,
    vidaraScraper,
    vidmolyScraper,
    voeScraper,
    rubyvidScraper,
    rpmshareScraper,
    okruScraper,
    vkScraper,
    fsstScraper,
  ];
}
