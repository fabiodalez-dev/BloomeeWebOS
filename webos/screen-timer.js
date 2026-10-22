export function createScreenTimer(options) {
  let timer=null, seconds=0, playing=false, active=true, off=false, pending=false, epoch=0;
  const later=options.setTimeout||setTimeout, cancel=options.clearTimeout||clearTimeout;
  function clear(){if(timer!==null)cancel(timer);timer=null;epoch++;}
  function arm(){clear();if(seconds>0&&playing&&active&&!off&&!pending){const mark=epoch;timer=later(async function(){timer=null;if(mark!==epoch)return;await sleep();},seconds*1000);}}
  async function sleep(){
    if(off||pending||!playing||!active)return false;
    pending=true;const mark=epoch;
    try{
      await options.off();off=true;
      // An interaction, pause or app exit during the native call cancels it.
      if(mark!==epoch||!playing||!active){await options.on();off=false;return false;}
      if(options.changed)options.changed(true);return true;
    }catch(e){if(options.error)options.error(e);return false;}
    finally{pending=false;}
  }
  async function wake(){clear();const wasOff=off||pending;if(off){try{await options.on();off=false;if(options.changed)options.changed(false);}catch(e){if(options.error)options.error(e);}}arm();return wasOff;}
  return {
    configure(value){seconds=Math.max(0,Math.min(3600,Math.round(Number(value)||0)));arm();},
    playing(value){playing=!!value;if(!playing)wake();else arm();},
    active(value){active=!!value;if(!active)wake();else arm();},
    activity(){if(off||pending){wake();return true;}arm();return false;},
    sleep,wake,isOff(){return off||pending;},dispose(){active=false;playing=false;return wake();}
  };
}
