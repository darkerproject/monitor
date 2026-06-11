(function(){
  "use strict";
  var peer=null,currentCall=null,localStream=null,screenStream=null;
  var sharing=false,micOn=true,camOn=true,musicMode=false;
  var selMic="",selCam="",selSpk="",selDaw="";
  var audioCtx=null,role=null;
  var dawOn=false,dawStream=null,silentTrack=null,dawMonitorEl=null;
  var voiceTrack=null,dawSlotTrack=null; // what's currently in each outgoing audio slot
  var remoteAudioEls={}; // track.id -> <audio>
  var meters=[],meterRAF=null;
  var $=function(id){return document.getElementById(id);};

  // ---------- theme ----------
  function applyTheme(dark){
    document.documentElement.setAttribute("data-theme",dark?"dark":"light");
    $("themeIcon").innerHTML = dark
      ? '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>'
      : '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>';
  }
  applyTheme(window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches);

  function toast(m){var t=$("toast");t.textContent=m;t.classList.add("show");clearTimeout(t._t);t._t=setTimeout(function(){t.classList.remove("show");},2400);}
  function setStatus(s,t){$("statusDot").className="dot "+(s||"");$("statusText").textContent=t;}
  function ensureCtx(){if(!audioCtx)audioCtx=new (window.AudioContext||window.webkitAudioContext)();if(audioCtx.state==="suspended")audioCtx.resume();return audioCtx;}

  // ---------- constraints ----------
  function micConstraints(){
    var c=musicMode?{echoCancellation:false,noiseSuppression:false,autoGainControl:false,channelCount:2}
                   :{echoCancellation:true,noiseSuppression:true,autoGainControl:true};
    if(selMic) c.deviceId={exact:selMic};
    return c;
  }
  function dawConstraints(){
    return {deviceId:{exact:selDaw},echoCancellation:false,noiseSuppression:false,autoGainControl:false,channelCount:2};
  }
  function videoConstraints(){var c={width:{ideal:1280},height:{ideal:720}};if(selCam)c.deviceId={exact:selCam};else c.facingMode="user";return c;}

  // ---------- media ----------
  function getMedia(){
    return navigator.mediaDevices.getUserMedia({audio:micConstraints(),video:videoConstraints()}).then(function(s){
      localStream=s; voiceTrack=s.getAudioTracks()[0]||null;
      $("localVideo").srcObject=s;
      registerMeter("meterMic",s);
      return populateDevices();
    });
  }
  function getSilentTrack(){
    if(silentTrack&&silentTrack.readyState==="live")return silentTrack;
    var dst=ensureCtx().createMediaStreamDestination();
    silentTrack=dst.stream.getAudioTracks()[0];
    return silentTrack;
  }
  // Outgoing stream: [voice, dawSlot, video] — order matters: receiver reads audio[0]=voz, audio[1]=DAW
  function buildOutStream(){
    var out=new MediaStream();
    if(voiceTrack)out.addTrack(voiceTrack);
    dawSlotTrack=(dawOn&&dawStream)?dawStream.getAudioTracks()[0]:getSilentTrack();
    out.addTrack(dawSlotTrack);
    localStream.getVideoTracks().forEach(function(t){out.addTrack(t);});
    return out;
  }

  // ---------- devices ----------
  function populateDevices(){
    return navigator.mediaDevices.enumerateDevices().then(function(devs){
      fill($("micSelect"),devs,"audioinput",selMic,null);
      fill($("dawSelect"),devs,"audioinput",selDaw,"— Elegir dispositivo —");
      fill($("camSelect"),devs,"videoinput",selCam,null);
      var hasSink=("setSinkId" in HTMLMediaElement.prototype),spk=$("spkSelect");
      if(hasSink){fill(spk,devs,"audiooutput",selSpk,null);spk.disabled=false;}
      else{spk.innerHTML='<option>No disponible en este navegador</option>';spk.disabled=true;}
      var m=$("micSelect"); if(m.selectedOptions[0])$("srcName").textContent=m.selectedOptions[0].textContent;
    });
  }
  function fill(sel,devs,kind,cur,placeholder){
    var list=devs.filter(function(d){return d.kind===kind;});sel.innerHTML="";
    if(placeholder){var ph=document.createElement("option");ph.value="";ph.textContent=placeholder;sel.appendChild(ph);}
    list.forEach(function(d,i){var o=document.createElement("option");o.value=d.deviceId;o.textContent=d.label||(kind+" "+(i+1));if(d.deviceId===cur)o.selected=true;sel.appendChild(o);});
    if(!placeholder&&list.length&&!cur)sel.selectedIndex=0;
  }

  // ---------- meters (one RAF loop, many meters) ----------
  function registerMeter(containerId,stream){
    var cont=$(containerId);
    var entry=meters.filter(function(m){return m.id===containerId;})[0];
    if(!entry){
      entry={id:containerId,segs:[],analyser:null};
      for(var i=0;i<20;i++){var s=document.createElement("div");s.className="seg";cont.appendChild(s);entry.segs.push(s);}
      meters.push(entry);
    }
    try{
      var src=ensureCtx().createMediaStreamSource(stream);
      entry.analyser=audioCtx.createAnalyser();entry.analyser.fftSize=512;
      src.connect(entry.analyser);
      entry.data=new Uint8Array(entry.analyser.fftSize);
    }catch(e){entry.analyser=null;}
    if(!meterRAF)meterLoop();
  }
  function meterLoop(){
    meterRAF=requestAnimationFrame(meterLoop);
    meters.forEach(function(m){
      if(!m.analyser)return;
      m.analyser.getByteTimeDomainData(m.data);
      var sum=0;for(var i=0;i<m.data.length;i++){var x=(m.data[i]-128)/128;sum+=x*x;}
      var level=Math.min(1,Math.sqrt(sum/m.data.length)*3.2),lit=Math.round(level*m.segs.length);
      for(var j=0;j<m.segs.length;j++){
        if(j<lit){var f=j/m.segs.length;m.segs[j].style.background=f>0.85?"#ff453a":f>0.65?"#ff9f0a":"#34c759";}
        else m.segs[j].style.background="var(--fill)";
      }
    });
  }

  // ---------- SDP: stereo + HQ Opus on ALL audio m-lines ----------
  function preferOpusHQ(sdp){
    var pts=[],re=/a=rtpmap:(\d+) opus\/48000/g,m;
    while((m=re.exec(sdp)))if(pts.indexOf(m[1])<0)pts.push(m[1]);
    pts.forEach(function(pt){
      var fre=new RegExp("a=fmtp:"+pt+" ([^\\r\\n]+)","g");
      if(fre.test(sdp)){
        sdp=sdp.replace(fre,function(full,p){
          if(!/stereo=/.test(p))p+=";stereo=1;sprop-stereo=1";
          if(!/maxaveragebitrate=/.test(p))p+=";maxaveragebitrate=256000";
          if(!/maxplaybackrate=/.test(p))p+=";maxplaybackrate=48000";
          return "a=fmtp:"+pt+" "+p;
        });
      } else {
        sdp=sdp.replace(new RegExp("(a=rtpmap:"+pt+" opus\\/48000\\/2)","g"),
          "$1\r\na=fmtp:"+pt+" stereo=1;sprop-stereo=1;maxaveragebitrate=256000;maxplaybackrate=48000");
      }
    });
    return sdp;
  }

  // ---------- remote playback: video element muted; one <audio> per remote audio track ----------
  function applySink(el){if(selSpk&&el.setSinkId)el.setSinkId(selSpk).catch(function(){});}
  function ensureRemoteAudio(stream){
    stream.getAudioTracks().forEach(function(t,idx){
      if(remoteAudioEls[t.id])return;
      var a=document.createElement("audio");
      a.autoplay=true;a.srcObject=new MediaStream([t]);
      a.dataset.kind=idx===0?"voz":"daw";
      document.body.appendChild(a);
      remoteAudioEls[t.id]=a;
      applySink(a);
      a.play().catch(function(){
        var once=function(){a.play().catch(function(){});document.removeEventListener("click",once);};
        document.addEventListener("click",once);
        toast("Toca la pantalla para activar el audio");
      });
    });
  }
  function clearRemoteAudio(){
    Object.keys(remoteAudioEls).forEach(function(k){var a=remoteAudioEls[k];try{a.srcObject=null;a.remove();}catch(e){}});
    remoteAudioEls={};
  }
  function attachRemote(stream){
    var v=$("remoteVideo");v.muted=true;v.srcObject=stream;
    document.body.classList.add("has-remote");
    setStatus("live","Conectado");
    ensureRemoteAudio(stream);
    stream.onaddtrack=function(){ensureRemoteAudio(stream);};
  }
  function remoteGone(t){
    document.body.classList.remove("has-remote");
    clearRemoteAudio();
    setStatus("","");
    toast(t||"La otra persona salió");
  }

  function watchConn(pc){
    if(!pc)return;
    pc.onconnectionstatechange=function(){var s=pc.connectionState;
      if(s==="connected")setStatus("live","Conectado");
      else if(s==="connecting")setStatus("wait","Conectando…");
      else if(s==="disconnected"||s==="failed")remoteGone("Conexión perdida");};
    setTimeout(function(){try{
      pc.getSenders().forEach(function(s){
        if(s.track&&s.track.kind==="audio"){var p=s.getParameters();if(!p.encodings)p.encodings=[{}];p.encodings[0].maxBitrate=256000;s.setParameters(p);}
      });
    }catch(e){}},1500);
  }

  function enterRoom(){$("home").style.display="none";$("room").classList.add("show");}

  // ---------- host / guest ----------
  function startHost(){
    role="host";document.body.classList.add("role-host");
    var b=$("startBtn");b.disabled=true;b.textContent="Pidiendo permisos…";
    ensureCtx();
    getMedia().then(function(){
      enterRoom();setStatus("","Listo");
      peer=new Peer(undefined,{debug:1});
      peer.on("open",function(id){$("shareLink").value=location.origin+location.pathname+"#"+id;});
      peer.on("call",function(c){
        currentCall=c;
        c.answer(buildOutStream(),{sdpTransform:preferOpusHQ});
        c.on("stream",attachRemote);
        c.on("close",function(){remoteGone();});
        watchConn(c.peerConnection);
      });
      peer.on("error",function(e){toast("Error: "+e.type);});
    }).catch(permsError);
  }
  function joinGuest(hostId){
    role="guest";document.body.classList.add("role-guest");
    ensureCtx();
    getMedia().then(function(){
      enterRoom();setStatus("wait","Conectando…");
      peer=new Peer(undefined,{debug:1});
      peer.on("open",function(){
        currentCall=peer.call(hostId,buildOutStream(),{sdpTransform:preferOpusHQ});
        currentCall.on("stream",attachRemote);
        currentCall.on("close",function(){remoteGone();});
        watchConn(currentCall.peerConnection);
      });
      peer.on("error",function(e){toast("Error: "+e.type);if(e.type==="peer-unavailable")setStatus("","No se encontró la sala");});
    }).catch(permsError);
  }
  function permsError(err){
    var msg=(err&&err.name==="NotAllowedError")?"Permiso denegado. Activa cámara y micrófono.":(err&&err.name==="NotFoundError")?"No se encontró cámara o micrófono.":"No se pudo acceder a los dispositivos.";
    toast(msg);var b=$("startBtn");if(b){b.disabled=false;b.textContent="Iniciar sala";}
  }

  // ---------- senders ----------
  function senderOfTrack(track){
    if(!currentCall||!currentCall.peerConnection||!track)return null;
    return currentCall.peerConnection.getSenders().filter(function(s){return s.track===track;})[0]||null;
  }
  function senderOfKind(k){
    if(!currentCall||!currentCall.peerConnection)return null;
    return currentCall.peerConnection.getSenders().filter(function(s){return s.track&&s.track.kind===k;})[0]||null;
  }

  // ---------- DAW source ----------
  function startDaw(){
    if(!selDaw){openSheet();toast("Elige la entrada del DAW");return;}
    navigator.mediaDevices.getUserMedia({audio:dawConstraints()}).then(function(s){
      dawStream=s;dawOn=true;
      var newTrack=s.getAudioTracks()[0];
      var snd=senderOfTrack(dawSlotTrack);
      if(snd)snd.replaceTrack(newTrack);
      dawSlotTrack=newTrack;
      // local monitoring: you hear the DAW through the browser
      if(!dawMonitorEl){dawMonitorEl=document.createElement("audio");dawMonitorEl.autoplay=true;document.body.appendChild(dawMonitorEl);}
      dawMonitorEl.srcObject=new MediaStream([newTrack]);
      applySink(dawMonitorEl);
      dawMonitorEl.play().catch(function(){});
      // meter + UI
      $("dawRow").style.display="block";
      var dsel=$("dawSelect");$("dawSrcName").textContent=dsel.selectedOptions[0]?dsel.selectedOptions[0].textContent:"";
      registerMeter("meterDaw",s);
      $("dawCtrl").classList.add("active");$("dawLbl").textContent="DAW ●";
      newTrack.onended=stopDaw;
      toast("Audio del DAW activado");
    }).catch(function(){toast("No se pudo capturar la entrada del DAW");});
  }
  function stopDaw(){
    if(!dawOn)return;
    dawOn=false;
    var snd=senderOfTrack(dawSlotTrack);
    var silent=getSilentTrack();
    if(snd)snd.replaceTrack(silent);
    dawSlotTrack=silent;
    if(dawStream)dawStream.getTracks().forEach(function(t){t.stop();});
    dawStream=null;
    if(dawMonitorEl)dawMonitorEl.srcObject=null;
    $("dawRow").style.display="none";
    var dm=meters.filter(function(m){return m.id==="meterDaw";})[0];if(dm)dm.analyser=null;
    $("dawCtrl").classList.remove("active");$("dawLbl").textContent="DAW";
    toast("Audio del DAW desactivado");
  }
  function toggleDaw(){if(dawOn)stopDaw();else startDaw();}

  // ---------- mic / cam / screen ----------
  function toggleMic(){micOn=!micOn;if(voiceTrack)voiceTrack.enabled=micOn;$("micCtrl").classList.toggle("off",!micOn);$("micLbl").textContent=micOn?"Mic":"Silenc.";}
  function toggleCam(){camOn=!camOn;localStream.getVideoTracks().forEach(function(t){t.enabled=camOn;});$("camCtrl").classList.toggle("off",!camOn);}
  function toggleScreen(){
    if(!sharing){
      navigator.mediaDevices.getDisplayMedia({video:true}).then(function(s){
        screenStream=s;var tr=s.getVideoTracks()[0];var snd=senderOfKind("video");if(snd)snd.replaceTrack(tr);
        var lv=$("localVideo");lv.srcObject=s;lv.classList.remove("mirror");lv.classList.add("screen");
        sharing=true;$("screenCtrl").classList.add("active");$("screenLbl").textContent="Detener";tr.onended=stopScreen;
      }).catch(function(){toast("No se compartió la pantalla");});
    } else stopScreen();
  }
  function stopScreen(){
    if(!sharing)return;var cam=localStream.getVideoTracks()[0];var snd=senderOfKind("video");if(snd&&cam)snd.replaceTrack(cam);
    var lv=$("localVideo");lv.srcObject=localStream;lv.classList.add("mirror");lv.classList.remove("screen");
    if(screenStream)screenStream.getTracks().forEach(function(t){t.stop();});screenStream=null;sharing=false;
    $("screenCtrl").classList.remove("active");$("screenLbl").textContent="Pantalla";
  }

  // ---------- swaps ----------
  function reacquireMic(){
    return navigator.mediaDevices.getUserMedia({audio:micConstraints()}).then(function(s){
      var nt=s.getAudioTracks()[0];
      var snd=senderOfTrack(voiceTrack);if(snd)snd.replaceTrack(nt);
      if(voiceTrack){voiceTrack.stop();localStream.removeTrack(voiceTrack);}
      localStream.addTrack(nt);voiceTrack=nt;nt.enabled=micOn;
      registerMeter("meterMic",new MediaStream([nt]));
    });
  }
  function swapCamera(){
    return navigator.mediaDevices.getUserMedia({video:videoConstraints()}).then(function(s){
      var nt=s.getVideoTracks()[0];
      if(!sharing){var snd=senderOfKind("video");if(snd)snd.replaceTrack(nt);$("localVideo").srcObject=s;}
      localStream.getVideoTracks().forEach(function(t){t.stop();localStream.removeTrack(t);});
      localStream.addTrack(nt);nt.enabled=camOn;
    });
  }
  function hangUp(){
    if(currentCall)currentCall.close();if(peer)peer.destroy();
    if(localStream)localStream.getTracks().forEach(function(t){t.stop();});
    if(screenStream)screenStream.getTracks().forEach(function(t){t.stop();});
    if(dawStream)dawStream.getTracks().forEach(function(t){t.stop();});
    if(meterRAF)cancelAnimationFrame(meterRAF);
    location.hash="";location.reload();
  }

  function openSheet(){$("scrim").classList.add("show");$("sheet").classList.add("show");}
  function closeSheet(){$("scrim").classList.remove("show");$("sheet").classList.remove("show");}

  // ---------- wiring ----------
  document.addEventListener("DOMContentLoaded",function(){
    $("themeBtn").addEventListener("click",function(){applyTheme(document.documentElement.getAttribute("data-theme")!=="dark");});
    $("startBtn").addEventListener("click",startHost);
    $("copyBtn").addEventListener("click",function(){
      var i=$("shareLink");i.select();i.setSelectionRange(0,99999);
      var ok=function(){var b=$("copyBtn");b.textContent="Copiado";b.classList.add("ok");setTimeout(function(){b.textContent="Copiar";b.classList.remove("ok");},1600);};
      if(navigator.clipboard)navigator.clipboard.writeText(i.value).then(ok,ok);else{document.execCommand("copy");ok();}
    });
    $("micCtrl").addEventListener("click",toggleMic);
    $("camCtrl").addEventListener("click",toggleCam);
    $("dawCtrl").addEventListener("click",toggleDaw);
    $("screenCtrl").addEventListener("click",toggleScreen);
    $("gearCtrl").addEventListener("click",openSheet);
    $("hangCtrl").addEventListener("click",hangUp);
    $("scrim").addEventListener("click",closeSheet);

    $("micSelect").addEventListener("change",function(){selMic=this.value;$("srcName").textContent=this.selectedOptions[0].textContent;reacquireMic().catch(function(){toast("No se pudo cambiar el micrófono");});});
    $("dawSelect").addEventListener("change",function(){
      selDaw=this.value;
      if(!selDaw){if(dawOn)stopDaw();return;}
      if(dawOn){stopDaw();startDaw();} else {startDaw();closeSheet();}
    });
    $("camSelect").addEventListener("change",function(){selCam=this.value;swapCamera().catch(function(){toast("No se pudo cambiar la cámara");});});
    $("spkSelect").addEventListener("change",function(){
      selSpk=this.value;
      Object.keys(remoteAudioEls).forEach(function(k){applySink(remoteAudioEls[k]);});
      if(dawMonitorEl)applySink(dawMonitorEl);
    });
    $("musicRow").addEventListener("click",function(){musicMode=!musicMode;$("musicSw").classList.toggle("on",musicMode);reacquireMic().then(function(){toast(musicMode?"Modo música activado":"Modo música desactivado");}).catch(function(){});});

    // refresh device lists live when something is plugged in / activated
    if(navigator.mediaDevices&&navigator.mediaDevices.addEventListener){
      navigator.mediaDevices.addEventListener("devicechange",function(){populateDevices();});
    }

    var hash=location.hash.replace(/^#/,"");
    if(hash){joinGuest(hash);}
  });
})();
