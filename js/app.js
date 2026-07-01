(function(){
  "use strict";
  // ---------- estado ----------
  var peer=null,localStream=null,screenStream=null;
  var sharing=false,micOn=true,camOn=true,musicMode=false;
  var selMic="",selCam="",selSpk="",selDaw="";
  var audioCtx=null,role=null,hostId=null,myId=null;
  var dawOn=false,dawStream=null,silentTrack=null,dawMonitorEl=null,dawNodes=null;
  var dawMonitorTap=null,dawMonitorDst=null,dawMonitorEqNodes=[];
  var dawGain=parseFloat(localStorage.getItem("dawGain")||"1")||1;
  var voiceTrack=null,dawSlotTrack=null,screenSlotTrack=null,blankVideoTrack=null,blankCamTrack=null,camSlotTrack=null,meScreenTile=null,meScreenVideo=null;
  var meters=[],meterRAF=null;
  var peers={}; // id -> {dc, call, name, avatar, index, cam, screen, hasVideo, tile, video, audioEls:[]}
  var myName=localStorage.getItem("myName")||"";
  var myAvatar=localStorage.getItem("myAvatar")||"";
  var myIndex=null; // host=1, invitados reciben el suyo en welcome
  var pending={}; // solicitudes en espera (solo host)
  var awaitingApproval=false;
  var hostCustomId=null,hostRoomName="",joinRoomName="",preSaveOn=false;
  var preMicOn=true,preCamOn=true,pendingJoin=null;
  var nextIndex=2;  // solo lo usa el host
  var $=function(id){return document.getElementById(id);};

  // ---------- tema ----------
  function applyTheme(dark){
    document.documentElement.setAttribute("data-theme",dark?"dark":"light");
    $("themeIcon").innerHTML = dark
      ? '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>'
      : '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>';
  }
  var phoneForceDark=window.matchMedia&&window.matchMedia("(max-width:480px)").matches;
  applyTheme(phoneForceDark||(window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches));

  function toast(m){var t=$("toast");t.textContent=m;t.classList.add("show");clearTimeout(t._t);t._t=setTimeout(function(){t.classList.remove("show");},2400);}
  function ensureCtx(){if(!audioCtx)audioCtx=new (window.AudioContext||window.webkitAudioContext)();if(audioCtx.state==="suspended")audioCtx.resume();return audioCtx;}

  // ---------- perfil ----------
  function camVisible(){return camOn;}
  function displayName(name,index){return name||("User "+(index||"?"));}
  function myDisplayName(){return displayName(myName,myIndex);}
  function myProfileMsg(){return {type:"profile",name:myName,avatar:myAvatar,index:myIndex,cam:camVisible(),screen:sharing};}

  // ---------- constraints ----------
  function micConstraints(){
    var c=musicMode?{echoCancellation:false,noiseSuppression:false,autoGainControl:false,channelCount:2}
                   :{echoCancellation:true,noiseSuppression:true,autoGainControl:true};
    if(selMic)c.deviceId={exact:selMic};
    return c;
  }
  function dawConstraints(){return {deviceId:{exact:selDaw},echoCancellation:false,noiseSuppression:false,autoGainControl:false,channelCount:2};}
  function videoConstraints(){var c={width:{ideal:1280},height:{ideal:720}};if(selCam)c.deviceId={exact:selCam};else c.facingMode="user";return c;}

  // ---------- media ----------
  function getMedia(){
    return navigator.mediaDevices.getUserMedia({audio:micConstraints(),video:videoConstraints()}).then(function(s){
      localStream=s;voiceTrack=s.getAudioTracks()[0]||null;
      camSlotTrack=s.getVideoTracks()[0]||null;
      $("meVideo").srcObject=s;
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
  function getBlankVideoTrack(){
    if(blankVideoTrack&&blankVideoTrack.readyState==="live")return blankVideoTrack;
    var c=document.createElement("canvas");c.width=2;c.height=2;
    c.getContext("2d").fillRect(0,0,2,2);
    blankVideoTrack=c.captureStream(1).getVideoTracks()[0];
    return blankVideoTrack;
  }
  function getBlankCamTrack(){
    if(blankCamTrack&&blankCamTrack.readyState==="live")return blankCamTrack;
    var c=document.createElement("canvas");c.width=2;c.height=2;
    c.getContext("2d").fillRect(0,0,2,2);
    blankCamTrack=c.captureStream(1).getVideoTracks()[0];
    return blankCamTrack;
  }
  // saliente: [voz, slot DAW, video] — el receptor lee audio[0]=voz, audio[1]=DAW
  function buildOutStream(){
    var out=new MediaStream();
    if(voiceTrack)out.addTrack(voiceTrack);
    dawSlotTrack=(dawOn&&dawNodes)?dawNodes.dst.stream.getAudioTracks()[0]:getSilentTrack();
    out.addTrack(dawSlotTrack);
    var cam=(camOn&&camSlotTrack&&camSlotTrack.readyState==="live")?camSlotTrack:getBlankCamTrack();
    out.addTrack(cam);
    screenSlotTrack=(sharing&&screenStream)?screenStream.getVideoTracks()[0]:getBlankVideoTrack();
    out.addTrack(screenSlotTrack);
    return out;
  }

  // ---------- dispositivos ----------
  function populateDevices(){
    return navigator.mediaDevices.enumerateDevices().then(function(devs){
      fill($("micSelect"),devs,"audioinput",selMic,null);
      fill($("dawSelect"),devs,"audioinput",selDaw,"— Elegir dispositivo —");
      fill($("camSelect"),devs,"videoinput",selCam,null);
      var hasSink=("setSinkId" in HTMLMediaElement.prototype),spk=$("spkSelect");
      if(hasSink){fill(spk,devs,"audiooutput",selSpk,null);spk.disabled=false;}
      else{spk.innerHTML='<option>No disponible en este navegador</option>';spk.disabled=true;}
      var m=$("micSelect");if(m.selectedOptions[0])$("srcName").textContent=m.selectedOptions[0].textContent;
      var d=$("dawSelect");$("inDawName").textContent=(selDaw&&d.selectedOptions[0])?d.selectedOptions[0].textContent:"Sin dispositivo";
    });
  }
  function fill(sel,devs,kind,cur,placeholder){
    var list=devs.filter(function(d){return d.kind===kind;});sel.innerHTML="";
    if(placeholder){var ph=document.createElement("option");ph.value="";ph.textContent=placeholder;sel.appendChild(ph);}
    list.forEach(function(d,i){var o=document.createElement("option");o.value=d.deviceId;o.textContent=d.label||(kind+" "+(i+1));if(d.deviceId===cur)o.selected=true;sel.appendChild(o);});
    if(!placeholder&&list.length&&!cur)sel.selectedIndex=0;
  }

  // ---------- medidores ----------
  function registerMeter(containerId,streamOrNode,isNode){
    var cont=$(containerId);
    var entry=meters.filter(function(m){return m.id===containerId;})[0];
    if(!entry){
      entry={id:containerId,segs:[],analyser:null};
      for(var i=0;i<20;i++){var s=document.createElement("div");s.className="seg";cont.appendChild(s);entry.segs.push(s);}
      meters.push(entry);
    }
    try{
      var ctx=ensureCtx();
      var src=isNode?streamOrNode:ctx.createMediaStreamSource(streamOrNode);
      entry.analyser=ctx.createAnalyser();entry.analyser.fftSize=512;
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

  // ---------- SDP ----------
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

  // ---------- malla de participantes ----------
  function ensurePeer(id){
    if(peers[id])return peers[id];
    var p={id:id,dc:null,call:null,name:"",avatar:"",index:null,cam:true,screen:false,hasVideo:false,audioEls:[],screenTrack:null,screenTile:null,screenVideo:null};
    peers[id]=p;
    createTile(p);
    updatePeersUI();
    return p;
  }
  function setupData(dc){
    var isApplicant=(role==="host"&&!peers[dc.peer]);
    if(isApplicant){
      pending[dc.peer]={dc:dc,name:"",avatar:"",notified:false};
      updateRequestsUI();
    } else {
      var p=ensurePeer(dc.peer);p.dc=dc;
    }
    dc.on("open",function(){if(!pending[dc.peer])dc.send(myProfileMsg());});
    dc.on("data",function(msg){
      if(!msg||!msg.type)return;
      var req=pending[dc.peer];
      if(req){
        if(msg.type==="profile"){
          req.name=msg.name||"";req.avatar=msg.avatar||"";
          if(!req.notified){req.notified=true;toast((req.name||"Alguien")+" quiere entrar a la sala");}
          updateRequestsUI();
        }
        return; // en espera: no puede hacer nada mas
      }
      handleData(dc.peer,msg);
    });
    dc.on("close",function(){
      if(pending[dc.peer]){delete pending[dc.peer];updateRequestsUI();return;}
      if(role==="guest"&&awaitingApproval){awaitingApproval=false;$("waitTitle").textContent="La sala se cerró";$("waitSub").textContent="Intenta con un enlace nuevo.";return;}
      removePeer(dc.peer);
    });
    dc.on("error",function(){});
  }
  // ---------- solicitudes (host) ----------
  function acceptRequest(id){
    var req=pending[id];if(!req)return;
    delete pending[id];
    var p=ensurePeer(id);
    p.dc=req.dc;p.name=req.name;p.avatar=req.avatar;
    try{
      req.dc.send(myProfileMsg());
      var others=Object.keys(peers).filter(function(k){return k!==id&&peers[k].dc&&peers[k].dc.open;});
      req.dc.send({type:"welcome",peers:others,index:nextIndex++});
    }catch(e){}
    updateTile(p);updateRequestsUI();updatePeersUI();
  }
  function rejectRequest(id){
    var req=pending[id];if(!req)return;
    delete pending[id];
    try{req.dc.send({type:"rejected"});}catch(e){}
    setTimeout(function(){try{req.dc.close();}catch(e){}},400);
    updateRequestsUI();
  }
  function updateHostTopUI(){
    if(role!=="host")return;
    var reqs=Object.keys(pending).length,members=Object.keys(peers).length;
    // el boton de ingresos aparece con la primera solicitud y se queda para siempre
    $("reqCtrl").hidden=!(reqs>0||members>0);
    // el card del enlace se va en cuanto alguien toca la puerta
    document.body.classList.toggle("has-requests",reqs>0);
  }
  function updateRequestsUI(){
    var ids=Object.keys(pending),n=ids.length;
    var c=$("reqCount");c.textContent=n;c.hidden=(n===0);
    $("reqEmpty").style.display=n?"none":"block";
    var list=$("reqList");list.innerHTML="";
    ids.forEach(function(id){
      var r=pending[id];
      var row=document.createElement("div");row.className="person";
      var av=document.createElement("div");av.className="person-av";
      if(r.avatar){var i=document.createElement("img");i.src=r.avatar;av.appendChild(i);}
      else av.textContent=(r.name||"?").trim().charAt(0).toUpperCase();
      var nm=document.createElement("span");nm.className="person-name";nm.textContent=r.name||"Invitado";
      var no=document.createElement("button");no.className="req-reject";no.textContent="Rechazar";
      no.addEventListener("click",function(){rejectRequest(id);});
      var ok=document.createElement("button");ok.className="req-accept";ok.textContent="Aceptar";
      ok.addEventListener("click",function(){acceptRequest(id);});
      row.appendChild(av);row.appendChild(nm);row.appendChild(no);row.appendChild(ok);
      list.appendChild(row);
    });
    updateHostTopUI();
  }
  function handleData(id,msg){
    if(!msg||!msg.type)return;
    var p=ensurePeer(id);
    if(msg.type==="profile"){
      p.name=msg.name||"";p.avatar=msg.avatar||"";
      if(msg.index)p.index=msg.index;
      if(typeof msg.cam==="boolean")p.cam=msg.cam;
      if(typeof msg.screen==="boolean")p.screen=msg.screen;
      if(p.screen)ensurePeerScreenTile(p);
      updateTile(p);updatePeersUI();
    } else if(msg.type==="cam"){
      p.cam=!!msg.on;p.screen=!!msg.screen;if(p.screen)ensurePeerScreenTile(p);updateTile(p);updatePeersUI();
    } else if(msg.type==="welcome"&&role==="guest"){
      if(!myIndex)myIndex=msg.index;
      if(awaitingApproval){
        awaitingApproval=false;
        $("waitingCard").hidden=true;
        applyInitialAV();enterRoom();
        var call=peer.call(hostId,buildOutStream(),{sdpTransform:preferOpusHQ});setupCall(call);
      }
      broadcast(myProfileMsg());refreshMyUI();
      (msg.peers||[]).forEach(function(pid){
        if(pid===myId||peers[pid])return;
        connectToPeer(pid); // el recién llegado inicia con cada existente
      });
    } else if(msg.type==="yt"){
      ytApplyRemote(msg);
    } else if(msg.type==="rejected"&&role==="guest"){
      awaitingApproval=false;
      $("waitingCard").hidden=false;
      $("waitTitle").textContent="No fuiste admitido";
      $("waitSub").textContent="El anfitrión no aceptó tu solicitud.";
      if(localStream)localStream.getTracks().forEach(function(t){t.stop();});
      try{if(peer)peer.destroy();}catch(e){}
    }
  }
  function connectToPeer(pid){
    var dc=peer.connect(pid);
    setupData(dc);
    var call=peer.call(pid,buildOutStream(),{sdpTransform:preferOpusHQ});
    setupCall(call);
  }
  function setupCall(call){
    var p=ensurePeer(call.peer);
    p.call=call;
    call.on("stream",function(stream){attachPeerStream(p,stream);});
    call.on("close",function(){removePeer(call.peer);});
    watchConn(call.peerConnection,call.peer);
  }
  function attachPeerStream(p,stream){
    syncPeerVideos(p,stream);
    ensurePeerAudio(p,stream);
    stream.onaddtrack=function(){ensurePeerAudio(p,stream);syncPeerVideos(p,stream);updatePeersUI();};
    updateTile(p);updatePeersUI();
  }
  function syncPeerVideos(p,stream){
    var vt=stream.getVideoTracks();
    if(vt[0]){
      p.hasVideo=true;p.video.muted=true;
      p.video.srcObject=new MediaStream([vt[0]]);
      p.video.play&&p.video.play().catch(function(){});
      p.video.onloadedmetadata=function(){updateTile(p);updatePeersUI();};
      vt[0].onunmute=function(){updateTile(p);};
    }
    if(vt[1]){p.screenTrack=vt[1];if(p.screen)ensurePeerScreenTile(p);}
  }
  function ensurePeerScreenTile(p){
    if(p.screenTile||!p.screenTrack)return;
    var t=document.createElement("div");t.className="tile screen-tile";t.hidden=true;
    t.innerHTML='<video autoplay playsinline muted></video><div class="tile-tag"></div>';
    $("grid").appendChild(t);
    p.screenTile=t;p.screenVideo=t.querySelector("video");
    p.screenVideo.srcObject=new MediaStream([p.screenTrack]);
    t.querySelector(".tile-tag").textContent=displayName(p.name,p.index)+" — pantalla";
  }
  function ensurePeerAudio(p,stream){
    stream.getAudioTracks().forEach(function(t,idx){
      if(p.audioEls.some(function(a){return a.dataset.tid===t.id;}))return;
      var a=document.createElement("audio");
      a.autoplay=true;
      a.dataset.tid=t.id;a.dataset.kind=idx===0?"voz":"daw";
      document.body.appendChild(a);
      p.audioEls.push(a);
      if(idx===0){a.srcObject=new MediaStream([t]);p.voiceAudio=a;applyVoiceListen(p);}
      else{eqAttach(a,new MediaStream([t]));p.dawAudio=a;applyDawListen();}
      applySink(a);
      a.play().catch(function(){
        var once=function(){document.querySelectorAll("audio").forEach(function(el){el.play().catch(function(){});});document.removeEventListener("click",once);};
        document.addEventListener("click",once);
        toast("Toca la pantalla para activar el audio");
      });
    });
  }
  function removePeer(id){
    var p=peers[id];if(!p)return;
    delete peers[id];
    try{if(p.call)p.call.close();}catch(e){}
    try{if(p.dc)p.dc.close();}catch(e){}
    p.audioEls.forEach(function(a){eqDetach(a);try{a.srcObject=null;a.remove();}catch(e){}});
    if(p.tile)p.tile.remove();
    if(p.screenTile)p.screenTile.remove();
    updatePeersUI();
    toast(displayName(p.name,p.index)+" salió");
  }
  function broadcast(msg){
    Object.keys(peers).forEach(function(k){var dc=peers[k].dc;if(dc&&dc.open){try{dc.send(msg);}catch(e){}}});
  }
  function watchConn(pc,pid){
    if(!pc)return;
    pc.onconnectionstatechange=function(){
      var s=pc.connectionState;
      if(s==="connected")updatePeersUI();
      else if(s==="disconnected"||s==="failed")removePeer(pid);
    };
    setTimeout(function(){try{
      pc.getSenders().forEach(function(s){
        if(s.track&&s.track.kind==="audio"){var pr=s.getParameters();if(!pr.encodings)pr.encodings=[{}];pr.encodings[0].maxBitrate=256000;s.setParameters(pr);}
      });
    }catch(e){}},1500);
  }
  function allSenders(){
    var arr=[];
    Object.keys(peers).forEach(function(k){var c=peers[k].call;if(c&&c.peerConnection)arr=arr.concat(c.peerConnection.getSenders());});
    return arr;
  }
  function replaceAcross(oldTrack,newTrack){allSenders().forEach(function(s){if(s.track===oldTrack)try{s.replaceTrack(newTrack);}catch(e){}});}

  // ---------- tiles ----------
  function watchAspect(v){
    var upd=function(){v.classList.toggle("portrait",v.videoHeight>v.videoWidth);};
    v.addEventListener("loadedmetadata",upd);v.addEventListener("resize",upd);
  }
  function makeVolSlider(onInput,initial){
    var wrap=document.createElement("div");wrap.className="tile-vol";
    wrap.innerHTML='<span class="tv-ic"><svg viewBox="0 0 24 24"><path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg></span><input type="range" class="tv-range" min="0" max="100">';
    var r=wrap.querySelector(".tv-range");r.value=(initial!=null?initial:100);
    var stop=function(e){e.stopPropagation();};
    r.addEventListener("input",function(){onInput(+this.value);});
    r.addEventListener("pointerdown",stop);r.addEventListener("click",stop);
    return wrap;
  }
  function createTile(p){
    var t=document.createElement("div");t.className="tile";
    t.innerHTML='<video autoplay playsinline muted></video><div class="tile-off show"><img class="tile-avatar" alt=""><span class="tile-name-big"></span></div><div class="tile-bar"><div class="tile-tag"></div></div>';
    $("grid").appendChild(t);
    p.tile=t;p.video=t.querySelector("video");watchAspect(p.video);
    updateTile(p);
  }
  function updateTile(p){
    if(!p.tile)return;
    var off=p.tile.querySelector(".tile-off"),img=p.tile.querySelector(".tile-avatar"),big=p.tile.querySelector(".tile-name-big"),tag=p.tile.querySelector(".tile-tag");
    var name=displayName(p.name,p.index);
    tag.textContent=name;
    var visible=p.hasVideo&&p.cam;
    off.classList.toggle("show",!visible);
    if(p.avatar){img.src=p.avatar;img.style.display="block";big.style.display="none";}
    else{img.style.display="none";big.style.display="block";big.textContent=name;}
    if(p.screenTile)p.screenTile.querySelector(".tile-tag").textContent=name+" — pantalla";
  }
  function updateMyTile(){
    var t=$("meTile");
    var off=t.querySelector(".tile-off"),img=t.querySelector(".tile-avatar"),big=t.querySelector(".tile-name-big"),tag=t.querySelector(".tile-tag");
    tag.textContent=myDisplayName()+" (tú)";
    var visible=camVisible();
    off.classList.toggle("show",!visible);
    if(myAvatar){img.src=myAvatar;img.style.display="block";big.style.display="none";}
    else{img.style.display="none";big.style.display="block";big.textContent=myDisplayName();}
    $("meVideo").classList.add("mirror");
  }
  function applyLayout(){
    var g=$("grid");
    var ids=Object.keys(peers);
    var ytTile=$("ytTile");
    var sharerScreen=null;
    if(sharing&&meScreenTile)sharerScreen=meScreenTile;
    else{for(var i=0;i<ids.length;i++){var pp=peers[ids[i]];if(pp.screen&&pp.screenTile){sharerScreen=pp.screenTile;break;}}}
    var screenTiles=[meScreenTile].concat(ids.map(function(k){return peers[k].screenTile;})).filter(Boolean);
    screenTiles.forEach(function(t){t.hidden=(t!==sharerScreen);});
    var bigTile=sharerScreen||ytTile||null; // pantalla tiene prioridad; si no, YouTube ocupa el grande
    document.body.classList.remove("layout-solo","layout-duo","layout-grid","layout-share");
    var cams=[$("meTile")].concat(ids.map(function(k){return peers[k].tile;})).filter(Boolean);
    if(ytTile&&ytTile!==bigTile)cams.push(ytTile);
    var total=cams.length;
    cams.concat(screenTiles).forEach(function(t){t.classList.remove("big","strip","center-span");t.style.removeProperty("--i");});
    if(ytTile)ytTile.classList.remove("big","strip","center-span");
    g.classList.toggle("solo",total===1&&!bigTile);
    g.style.gridTemplateColumns="";g.style.removeProperty("--cols");
    if(bigTile){
      document.body.classList.add("layout-share");
      bigTile.classList.add("big");
      cams.forEach(function(t,i){t.classList.add("strip");t.style.setProperty("--i",i);});
      g.style.gridTemplateColumns="repeat("+Math.max(cams.length,1)+",1fr)";
    } else if(total===1){
      document.body.classList.add("layout-solo");
    } else if(total===2){
      document.body.classList.add("layout-duo");
    } else {
      document.body.classList.add("layout-grid");
      var cols=total<=4?2:3;
      g.style.gridTemplateColumns="repeat("+cols+",1fr)";
      g.style.setProperty("--cols",cols);
      if(total%cols===1)$("meTile").classList.add("center-span");
    }
  }
  function updatePeersUI(){
    var n=Object.keys(peers).length;
    document.body.classList.toggle("has-remote",n>0);
    $("grid").classList.toggle("solo",n===0);
    $("peopleCount").textContent=n+1;
    // lista del panel Personas
    var list=$("peopleList");list.innerHTML="";
    var mkRow=function(name,avatar,me){
      var r=document.createElement("div");r.className="person";
      var av=document.createElement("div");av.className="person-av";
      if(avatar){var i=document.createElement("img");i.src=avatar;av.appendChild(i);}
      else av.textContent=(name||"?").trim().charAt(0).toUpperCase();
      var nm=document.createElement("span");nm.className="person-name";nm.textContent=name+(me?" (tú)":"");
      r.appendChild(av);r.appendChild(nm);list.appendChild(r);
    };
    mkRow(myDisplayName(),myAvatar,true);
    Object.keys(peers).forEach(function(k){var p=peers[k];mkRow(displayName(p.name,p.index),p.avatar,false);});
    updateMyTile();
    applyLayout();
    updateHostTopUI();
    refreshConsole();
  }
  function refreshMyUI(){
    $("nameInput").value=myName;
    var av=$("myAvatar");
    av.innerHTML="";
    if(myAvatar){var i=document.createElement("img");i.src=myAvatar;av.appendChild(i);}
    else{av.textContent=(myDisplayName()).trim().charAt(0).toUpperCase();}
    updatePeersUI();
  }

  // ---------- salida / sink ----------
  function applySink(el){if(selSpk&&el.setSinkId)el.setSinkId(selSpk).catch(function(){});}
  function applySinkAll(){
    Object.keys(peers).forEach(function(k){peers[k].audioEls.forEach(applySink);});
    if(dawMonitorEl)applySink(dawMonitorEl);
  }

  function enterRoom(){$("home").style.display="none";$("room").classList.add("show");}
  // ---------- previews del pre-join ----------
  var preMicStream=null,preCamStream=null;
  function startMicPreview(){
    navigator.mediaDevices.getUserMedia({audio:micConstraints()}).then(function(s){
      preMicStream=s;ensureCtx();
      $("preMeterWrap").classList.add("show");
      registerMeter("meterPre",s);
    }).catch(function(){preMicOn=false;$("preMicSw").classList.remove("on");toast("No se pudo acceder al micrófono");});
  }
  function stopMicPreview(){
    if(preMicStream){preMicStream.getTracks().forEach(function(t){t.stop();});preMicStream=null;}
    var m=meters.filter(function(x){return x.id==="meterPre";})[0];if(m)m.analyser=null;
    $("preMeterWrap").classList.remove("show");
  }
  function startCamPreview(){
    navigator.mediaDevices.getUserMedia({video:videoConstraints()}).then(function(s){
      preCamStream=s;$("preCamVideo").srcObject=s;$("preCamWrap").classList.add("show");
    }).catch(function(){preCamOn=false;$("preCamSw").classList.remove("on");toast("No se pudo acceder a la cámara");});
  }
  function stopCamPreview(){
    if(preCamStream){preCamStream.getTracks().forEach(function(t){t.stop();});preCamStream=null;}
    $("preCamVideo").srcObject=null;$("preCamWrap").classList.remove("show");
  }
  function applyInitialAV(){
    if(voiceTrack)voiceTrack.enabled=micOn;
    if(localStream){
      if(camOn){camSlotTrack=localStream.getVideoTracks()[0]||camSlotTrack;}
      else{
        var real=localStream.getVideoTracks()[0];
        if(real){try{real.stop();localStream.removeTrack(real);}catch(e){}}
        camSlotTrack=getBlankCamTrack();
      }
    }
    $("micCtrl").classList.toggle("off",!micOn);
    $("micLbl").textContent=micOn?"Mic":"Silenc.";
    $("camCtrl").classList.toggle("off",!camOn);
  }

  // ---------- inicio ----------
  function initHostPeer(){
    if(peer)return;
    peer=hostCustomId?new Peer(hostCustomId,{debug:1}):new Peer(undefined,{debug:1});
    peer.on("open",function(id){
      myId=id;hostId=id;
      var url=location.origin+location.pathname+"#"+id+(hostRoomName?"&n="+encodeURIComponent(hostRoomName):"");
      $("shareLink").value=url;$("shareLink2").value=url;
    });
    peer.on("connection",setupData);
    peer.on("call",function(c){if(!peers[c.peer]||!localStream){try{c.close();}catch(e){}return;}c.answer(buildOutStream(),{sdpTransform:preferOpusHQ});setupCall(c);});
    peer.on("error",function(e){
      if(e.type==="unavailable-id"){toast("Esta sala ya está abierta en otra pestaña o dispositivo");return;}
      toast("Error: "+e.type);
    });
  }
  function startHost(){
    role="host";myIndex=1;document.body.classList.add("role-host");
    var b=$("startBtn");b.disabled=true;b.textContent="Pidiendo permisos…";
    ensureCtx();
    initHostPeer();
    getMedia().then(function(){
      applyInitialAV();
      enterRoom();refreshMyUI();
    }).catch(permsError);
  }
  function joinGuest(hid){
    role="guest";hostId=hid;document.body.classList.add("role-guest");
    ensureCtx();
    getMedia().then(function(){
      awaitingApproval=true;
      $("waitingCard").hidden=false;
      if(joinRoomName)$("waitSub").textContent='Solicitaste entrar a "'+joinRoomName+'". Mantén esta pestaña abierta.';
      refreshMyUI();
      peer=new Peer(undefined,{debug:1});
      peer.on("open",function(id){
        myId=id;
        var url=location.origin+location.pathname+"#"+hid;
        $("shareLink").value=url;$("shareLink2").value=url;
        var dc=peer.connect(hid);setupData(dc);
      });
      peer.on("connection",setupData);
      peer.on("call",function(c){c.answer(buildOutStream(),{sdpTransform:preferOpusHQ});setupCall(c);});
      peer.on("error",function(e){
        if(e.type==="peer-unavailable"){$("waitTitle").textContent="No se encontró la sala";$("waitSub").textContent="El enlace puede haber expirado. Pide uno nuevo.";}
        else toast("Error: "+e.type);
      });
    }).catch(permsError);
  }
  function permsError(err){
    var msg=(err&&err.name==="NotAllowedError")?"Permiso denegado. Activa cámara y micrófono.":(err&&err.name==="NotFoundError")?"No se encontró cámara o micrófono.":"No se pudo acceder a los dispositivos.";
    toast(msg);var b=$("startBtn");if(b){b.disabled=false;b.textContent="Iniciar sala";}
  }

  // ---------- EQ de audífonos (corrección local por oyente) ----------
  var eqOn=localStorage.getItem("eqOn")==="1";
  var eqModel=localStorage.getItem("eqModel")||"";
  var eqCatalog=null,eqLoading=false;
  var eqTargets=[]; // {el, raw, srcNode, dst, nodes:[]}
  var EQ_TYPE={PK:"peaking",LSC:"lowshelf",HSC:"highshelf"};

  function loadEqCatalog(cb){
    if(eqCatalog){cb&&cb();return;}
    if(eqLoading){return;}
    eqLoading=true;
    fetch("assets/headphones-eq.json").then(function(r){return r.json();}).then(function(d){
      eqCatalog=d;eqLoading=false;
      if(typeof renderEqResults==="function"&&$("eqSearch"))renderEqResults($("eqSearch").value);
      cb&&cb();
    }).catch(function(){eqLoading=false;toast("No se pudo cargar el catálogo de audífonos");});
  }
  function findEqModel(name){
    if(!eqCatalog||!name)return null;
    for(var i=0;i<eqCatalog.models.length;i++)if(eqCatalog.models[i].n===name)return eqCatalog.models[i];
    return null;
  }
  function eqTeardown(t){
    if(t.srcNode){try{t.srcNode.disconnect();}catch(e){}t.srcNode=null;}
    t.nodes.forEach(function(n){try{n.disconnect();}catch(e){}});t.nodes=[];
    t.dst=null;
  }
  function eqApply(t){
    eqTeardown(t);
    var model=(eqOn&&eqModel)?findEqModel(eqModel):null;
    if(!model){t.el.srcObject=t.raw;t.el.play&&t.el.play().catch(function(){});return;}
    var ctx=ensureCtx();
    var src=ctx.createMediaStreamSource(t.raw);
    var dst=ctx.createMediaStreamDestination();
    var pre=ctx.createGain();pre.gain.value=Math.pow(10,(model.p||0)/20);
    src.connect(pre);var prev=pre;t.nodes.push(pre);
    model.f.forEach(function(b){
      var bq=ctx.createBiquadFilter();
      bq.type=EQ_TYPE[b[0]]||"peaking";bq.frequency.value=b[1];bq.gain.value=b[2];bq.Q.value=b[3];
      prev.connect(bq);prev=bq;t.nodes.push(bq);
    });
    prev.connect(dst);
    t.srcNode=src;t.dst=dst;
    t.el.srcObject=dst.stream;t.el.play&&t.el.play().catch(function(){});
  }
  function eqAttach(el,raw){var t={el:el,raw:raw,srcNode:null,dst:null,nodes:[]};eqTargets.push(t);eqApply(t);return t;}
  function eqDetach(el){
    for(var i=eqTargets.length-1;i>=0;i--){if(eqTargets[i].el===el){eqTeardown(eqTargets[i]);eqTargets.splice(i,1);}}
  }
  function eqRebuildAll(){
    if(eqOn&&eqModel&&!eqCatalog){loadEqCatalog(eqRebuildAll);return;}
    eqTargets.forEach(eqApply);
    buildDawMonitorEq();
  }
  // monitor local del DAW: cadena de nodos directos (g → tap → [eq] → dst → audio), sin re-capturar streams
  function buildDawMonitorEq(){
    if(!dawMonitorTap||!dawMonitorDst)return;
    var ctx=ensureCtx();
    dawMonitorEqNodes.forEach(function(n){try{n.disconnect();}catch(e){}});dawMonitorEqNodes=[];
    try{dawMonitorTap.disconnect();}catch(e){}
    var model=(eqOn&&eqModel)?findEqModel(eqModel):null;
    if(!model){dawMonitorTap.connect(dawMonitorDst);return;}
    var pre=ctx.createGain();pre.gain.value=Math.pow(10,(model.p||0)/20);
    dawMonitorTap.connect(pre);var prev=pre;dawMonitorEqNodes.push(pre);
    model.f.forEach(function(b){
      var bq=ctx.createBiquadFilter();
      bq.type=EQ_TYPE[b[0]]||"peaking";bq.frequency.value=b[1];bq.gain.value=b[2];bq.Q.value=b[3];
      prev.connect(bq);prev=bq;dawMonitorEqNodes.push(bq);
    });
    prev.connect(dawMonitorDst);
  }
  function updateEqCurrent(){
    var el=$("eqCurrent");if(!el)return;
    if(eqModel){
      el.innerHTML='Calibrado para <b></b><span class="eq-clear">Quitar</span>';
      el.querySelector("b").textContent=eqModel;
      el.classList.add("show");
      el.querySelector(".eq-clear").addEventListener("click",function(){
        eqModel="";try{localStorage.removeItem("eqModel");}catch(e){}
        var s=$("eqSearch");if(s)s.value="";
        updateEqCurrent();eqRebuildAll();
      });
    }else{el.className="eq-current";el.textContent="";}
  }
  function selectEqModel(name){
    eqModel=name;try{localStorage.setItem("eqModel",name);}catch(e){}
    var s=$("eqSearch");if(s)s.value=name;
    var r=$("eqResults");if(r){r.classList.remove("show");r.innerHTML="";}
    if(!eqOn){eqOn=true;try{localStorage.setItem("eqOn","1");}catch(e){}var sw=$("eqSw");if(sw)sw.classList.add("on");}
    updateEqCurrent();eqRebuildAll();
    toast("Audífonos calibrados: "+name);
  }
  function renderEqResults(q){
    var box=$("eqResults");if(!box)return;
    q=(q||"").trim().toLowerCase();
    if(!q){box.classList.remove("show");box.innerHTML="";return;}
    if(!eqCatalog){loadEqCatalog();box.innerHTML='<div class="eq-opt empty">Cargando catálogo…</div>';box.classList.add("show");return;}
    var out=[],i,m,terms=q.split(/\s+/);
    for(i=0;i<eqCatalog.models.length&&out.length<12;i++){
      m=eqCatalog.models[i];var hay=m.n.toLowerCase();
      var ok=true;for(var k=0;k<terms.length;k++){if(hay.indexOf(terms[k])<0){ok=false;break;}}
      if(ok)out.push(m);
    }
    box.innerHTML="";
    if(!out.length){box.innerHTML='<div class="eq-opt empty">Sin resultados</div>';box.classList.add("show");return;}
    out.forEach(function(m){
      var b=document.createElement("button");b.className="eq-opt";b.type="button";b.textContent=m.n;
      b.addEventListener("click",function(){selectEqModel(m.n);});
      box.appendChild(b);
    });
    box.classList.add("show");
  }

  // ---------- DAW ----------
  function startDaw(){
    if(!selDaw){openSheet("sheet");toast("Elige la entrada del DAW");return;}
    navigator.mediaDevices.getUserMedia({audio:dawConstraints()}).then(function(s){
      dawStream=s;dawOn=true;
      var ctx=ensureCtx();
      var src=ctx.createMediaStreamSource(s);
      var g=ctx.createGain();g.gain.value=dawGain;
      var dst=ctx.createMediaStreamDestination();
      src.connect(g);g.connect(dst);
      dawNodes={src:src,gain:g,dst:dst};
      var newTrack=dst.stream.getAudioTracks()[0];
      replaceAcross(dawSlotTrack,newTrack);
      dawSlotTrack=newTrack;
      if(!dawMonitorEl){dawMonitorEl=document.createElement("audio");dawMonitorEl.autoplay=true;document.body.appendChild(dawMonitorEl);}
      dawMonitorTap=ctx.createGain();g.connect(dawMonitorTap);
      dawMonitorDst=ctx.createMediaStreamDestination();
      buildDawMonitorEq();
      dawMonitorEl.srcObject=dawMonitorDst.stream;
      applySink(dawMonitorEl);
      applyDawListen();
      dawMonitorEl.play().catch(function(){});
      $("dawRow").style.display="block";
      var dsel=$("dawSelect");$("dawSrcName").textContent=dsel.selectedOptions[0]?dsel.selectedOptions[0].textContent:"";
      registerMeter("meterDaw",g,true);
      $("inDawSw").classList.add("on");setDawToolState(true);
      s.getAudioTracks()[0].onended=stopDaw;
      toast("Audio del DAW activado");
      refreshConsole();
    }).catch(function(){toast("No se pudo capturar la entrada del DAW");$("inDawSw").classList.remove("on");});
  }
  function stopDaw(){
    if(!dawOn)return;
    dawOn=false;
    var silent=getSilentTrack();
    replaceAcross(dawSlotTrack,silent);
    dawSlotTrack=silent;
    if(dawStream)dawStream.getTracks().forEach(function(t){t.stop();});
    dawStream=null;
    if(dawNodes){try{dawNodes.src.disconnect();dawNodes.gain.disconnect();dawNodes.dst.stream.getTracks().forEach(function(t){t.stop();});}catch(e){}dawNodes=null;}
    dawMonitorEqNodes.forEach(function(n){try{n.disconnect();}catch(e){}});dawMonitorEqNodes=[];
    if(dawMonitorTap){try{dawMonitorTap.disconnect();}catch(e){}dawMonitorTap=null;}
    if(dawMonitorDst){try{dawMonitorDst.stream.getTracks().forEach(function(t){t.stop();});}catch(e){}dawMonitorDst=null;}
    if(dawMonitorEl)dawMonitorEl.srcObject=null;
    $("dawRow").style.display="none";
    var dm=meters.filter(function(m){return m.id==="meterDaw";})[0];if(dm)dm.analyser=null;
    $("inDawSw").classList.remove("on");setDawToolState(false);
    toast("Audio del DAW desactivado");
    refreshConsole();
  }
  function setDawToolState(on){
    var it=$("toolDaw");if(it)it.classList.toggle("on",on);
    var st=$("toolDawState");if(st)st.textContent=on?"On":"Off";
    var sub=$("toolDawSub");if(sub)sub.textContent=on?"Transmitiendo a la sala. Toca para detener.":"Transmite el audio de tu DAW a la sala";
  }
  function toggleDaw(){if(dawOn)stopDaw();else startDaw();}

  // ---------- mic / cam / pantalla ----------
  function notifyCam(){broadcast({type:"cam",on:camOn,screen:sharing});}
  function toggleMic(){
    micOn=!micOn;if(voiceTrack)voiceTrack.enabled=micOn;
    $("micCtrl").classList.toggle("off",!micOn);
    $("micLbl").textContent=micOn?"Mic":"Silenc.";
  }
  function toggleCam(){
    if(camOn){
      // Apagar de verdad: detener la pista física (apaga la luz y libera la cámara)
      camOn=false;
      $("camCtrl").classList.toggle("off",true);
      var real=localStream?localStream.getVideoTracks()[0]:null;
      var blank=getBlankCamTrack();
      if(real){replaceAcross(real,blank);try{real.stop();localStream.removeTrack(real);}catch(e){}}
      else if(camSlotTrack&&camSlotTrack!==blank){replaceAcross(camSlotTrack,blank);}
      camSlotTrack=blank;
      updateMyTile();notifyCam();
    }else{
      // Encender: volver a adquirir la cámara
      navigator.mediaDevices.getUserMedia({video:videoConstraints()}).then(function(s){
        var nt=s.getVideoTracks()[0];
        replaceAcross(camSlotTrack,nt);
        camSlotTrack=nt;camOn=true;
        $("camCtrl").classList.toggle("off",false);
        if(localStream){
          localStream.getVideoTracks().forEach(function(t){try{t.stop();localStream.removeTrack(t);}catch(e){}});
          localStream.addTrack(nt);$("meVideo").srcObject=localStream;
        }
        updateMyTile();notifyCam();
      }).catch(function(){toast("No se pudo encender la cámara");});
    }
  }
  function ensureMeScreenTile(){
    if(meScreenTile)return;
    meScreenTile=document.createElement("div");meScreenTile.className="tile screen-tile";
    meScreenTile.innerHTML='<video autoplay playsinline muted></video><div class="tile-tag">Tu pantalla</div>';
    $("grid").appendChild(meScreenTile);
    meScreenVideo=meScreenTile.querySelector("video");
  }
  function toggleScreen(){
    if(!sharing){
      navigator.mediaDevices.getDisplayMedia({video:true}).then(function(s){
        screenStream=s;var tr=s.getVideoTracks()[0];
        replaceAcross(screenSlotTrack,tr);screenSlotTrack=tr;
        ensureMeScreenTile();
        meScreenVideo.srcObject=s;
        sharing=true;
        $("inScreenSw").classList.add("on");$("inScreenName").textContent="Compartiendo";$("screenCtrl").classList.add("active");
        closeSheets();
        tr.onended=stopScreen;
        updatePeersUI();notifyCam();
      }).catch(function(){toast("No se compartió la pantalla");});
    } else stopScreen();
  }
  function stopScreen(){
    if(!sharing)return;
    sharing=false;
    var blank=getBlankVideoTrack();
    replaceAcross(screenSlotTrack,blank);screenSlotTrack=blank;
    if(meScreenVideo)meScreenVideo.srcObject=null;
    if(screenStream)screenStream.getTracks().forEach(function(t){t.stop();});
    screenStream=null;
    $("inScreenSw").classList.remove("on");$("inScreenName").textContent="Inactivo";$("screenCtrl").classList.remove("active");
    updatePeersUI();notifyCam();
  }

  // ---------- swaps ----------
  function reacquireMic(){
    return navigator.mediaDevices.getUserMedia({audio:micConstraints()}).then(function(s){
      var nt=s.getAudioTracks()[0];
      replaceAcross(voiceTrack,nt);
      if(voiceTrack){voiceTrack.stop();localStream.removeTrack(voiceTrack);}
      localStream.addTrack(nt);voiceTrack=nt;nt.enabled=micOn;
      registerMeter("meterMic",new MediaStream([nt]));
    });
  }
  function swapCamera(){
    if(!camOn)return Promise.resolve(); // se aplicará al encender la cámara (usa selCam)
    return navigator.mediaDevices.getUserMedia({video:videoConstraints()}).then(function(s){
      var nt=s.getVideoTracks()[0];
      replaceAcross(camSlotTrack,nt);
      camSlotTrack=nt;
      if(localStream){
        localStream.getVideoTracks().forEach(function(t){try{t.stop();localStream.removeTrack(t);}catch(e){}});
        localStream.addTrack(nt);
        $("meVideo").srcObject=localStream;
      }
    });
  }
  function hangUp(){
    Object.keys(peers).forEach(function(k){try{peers[k].call&&peers[k].call.close();peers[k].dc&&peers[k].dc.close();}catch(e){}});
    Object.keys(pending).forEach(function(k){try{pending[k].dc.close();}catch(e){}});
    if(peer){try{peer.destroy();}catch(e){}}
    if(localStream)localStream.getTracks().forEach(function(t){t.stop();});
    if(screenStream)screenStream.getTracks().forEach(function(t){t.stop();});
    if(dawStream)dawStream.getTracks().forEach(function(t){t.stop();});
    if(meterRAF)cancelAnimationFrame(meterRAF);
    var phone=window.matchMedia&&window.matchMedia("(max-width:480px)").matches;
    if(phone){
      // volver a inicio al instante (sin recarga pesada de Safari)
      $("room").classList.remove("show");
      $("home").style.display="";
      if(location.hash){history.replaceState(null,"",location.pathname+location.search);}
      setTimeout(function(){location.reload();},60); // recarga en segundo plano para limpiar estado
    } else {
      location.hash="";location.reload();
    }
  }

  // ---------- avatar ----------
  function setAvatarFromFile(file){
    if(!file||!/^image\//.test(file.type)){toast("Elige una imagen");return;}
    var r=new FileReader();
    r.onload=function(){
      var img=new Image();
      img.onload=function(){
        var c=document.createElement("canvas");c.width=c.height=128;
        var x=c.getContext("2d");
        var s=Math.min(img.width,img.height);
        x.drawImage(img,(img.width-s)/2,(img.height-s)/2,s,s,0,0,128,128);
        myAvatar=c.toDataURL("image/jpeg",0.82);
        try{localStorage.setItem("myAvatar",myAvatar);}catch(e){}
        refreshMyUI();broadcast(myProfileMsg());
      };
      img.src=r.result;
    };
    r.readAsDataURL(file);
  }

  // ---------- sheets ----------
  var sheetIds=["sheet","peopleSheet","inputsSheet","prejoinSheet","reqSheet","myRoomsSheet","joinSheet","toolsSheet","consoleSheet"];
  function cancelPrejoin(){
    // aborta el flujo de entrada y libera lo reservado
    stopMicPreview();stopCamPreview();
    if(pendingJoin==="host"&&peer){try{peer.destroy();}catch(e){}peer=null;role=null;hostCustomId=null;hostRoomName="";}
    pendingJoin=null;
  }
  // ---------- YouTube (referencias sincronizadas) ----------
  var YT_KEY="AIzaSyBKii3TN_TVgV5Y8GmjB36vK9CY8yb6s_w";
  var ytPlayer=null,ytReady=false,ytCurrentVideo=null,ytSyncTimer=null,ytApplyingRemote=false,ytSearchTimer=null,ytVol=100;

  function loadYTApi(cb){
    if(window.YT&&window.YT.Player){cb&&cb();return;}
    if(!document.getElementById("yt-iframe-api")){
      var tag=document.createElement("script");tag.id="yt-iframe-api";tag.src="https://www.youtube.com/iframe_api";
      document.head.appendChild(tag);
    }
    var prev=window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady=function(){if(prev)prev();cb&&cb();};
  }
  function ensureYTTile(){
    if($("ytTile"))return $("ytTile");
    var t=document.createElement("div");t.className="tile yt-tile";t.id="ytTile";
    var frame=document.createElement("div");frame.id="ytTileFrame";t.appendChild(frame);
    var tag=document.createElement("div");tag.className="tile-tag";tag.textContent="YouTube";t.appendChild(tag);
    $("grid").appendChild(t);
    applyLayout();
    return t;
  }
  function removeYTTile(){var t=$("ytTile");if(t){t.remove();applyLayout();}}
  function ensureYTPlayer(cb){
    if(ytPlayer&&ytReady){cb&&cb();return;}
    var target;
    if(role==="host")target="ytFrame";
    else{ensureYTTile();target="ytTileFrame";}
    loadYTApi(function(){
      if(ytPlayer){if(ytReady)cb&&cb();return;}
      ytPlayer=new YT.Player(target,{
        height:"100%",width:"100%",videoId:"",
        playerVars:{playsinline:1,rel:0,modestbranding:1},
        events:{
          "onReady":function(){ytReady=true;applyYtListen();cb&&cb();},
          "onStateChange":onYTStateChange
        }
      });
    });
  }
  function openYTPanel(){ // solo anfitrión: panel flotante con buscador
    $("ytPanel").classList.add("show");$("ytSearchWrap").style.display="block";
  }
  function closeYTPanel(){ // solo anfitrión (botón X): cierra para todos
    $("ytPanel").classList.remove("show");$("ytPanel").classList.remove("has-video");
    if(ytPlayer&&ytPlayer.stopVideo){try{ytPlayer.stopVideo();}catch(e){}}
    ytCurrentVideo=null;
    if(ytSyncTimer){clearInterval(ytSyncTimer);ytSyncTimer=null;}
    broadcast({type:"yt",action:"close"});
    refreshConsole();
  }
  function ytHostPlay(videoId){
    openYTPanel();
    ensureYTPlayer(function(){
      ytCurrentVideo=videoId;
      $("ytPanel").classList.add("has-video");
      ytApplyingRemote=true;ytPlayer.loadVideoById(videoId);setTimeout(function(){ytApplyingRemote=false;},400);
      broadcast({type:"yt",action:"load",videoId:videoId});
      startYTSync();
      applyYtListen();refreshConsole();
    });
  }
  function onYTStateChange(e){
    if(role!=="host"||ytApplyingRemote)return;
    var t=ytPlayer.getCurrentTime?ytPlayer.getCurrentTime():0;
    if(e.data===1)broadcast({type:"yt",action:"play",time:t,videoId:ytCurrentVideo});
    else if(e.data===2)broadcast({type:"yt",action:"pause",time:t});
  }
  function startYTSync(){
    if(ytSyncTimer)clearInterval(ytSyncTimer);
    ytSyncTimer=setInterval(function(){
      if(role==="host"&&ytPlayer&&ytPlayer.getPlayerState&&ytPlayer.getPlayerState()===1){
        broadcast({type:"yt",action:"sync",videoId:ytCurrentVideo,time:ytPlayer.getCurrentTime()});
      }
    },4000);
  }
  function ytApplyRemote(msg){
    if(role==="host")return; // solo el anfitrión controla
    if(msg.action==="close"){
      if(ytPlayer&&ytPlayer.stopVideo){try{ytPlayer.stopVideo();}catch(e){}}
      removeYTTile();ytCurrentVideo=null;refreshConsole();return;
    }
    ensureYTPlayer(function(){
      ytApplyingRemote=true;
      var cur=ytPlayer.getCurrentTime?ytPlayer.getCurrentTime():0;
      if(msg.videoId&&msg.videoId!==ytCurrentVideo){
        ytCurrentVideo=msg.videoId;
        ytPlayer.loadVideoById(msg.videoId,msg.time||0);
        applyYtListen();refreshConsole();
      } else if(msg.action==="play"){
        if(Math.abs(cur-(msg.time||0))>1.2)ytPlayer.seekTo(msg.time||0,true);
        ytPlayer.playVideo();
      } else if(msg.action==="pause"){
        ytPlayer.seekTo(msg.time||0,true);ytPlayer.pauseVideo();
      } else if(msg.action==="sync"){
        if(Math.abs(cur-(msg.time||0))>1.5)ytPlayer.seekTo(msg.time||0,true);
      }
      setTimeout(function(){ytApplyingRemote=false;},400);
    });
  }
  function ytSearch(q){
    var box=$("ytResults");
    if(!q.trim()){box.innerHTML="";return;}
    box.innerHTML='<div class="yt-empty">Buscando…</div>';
    fetch("https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=12&q="+encodeURIComponent(q)+"&key="+YT_KEY)
      .then(function(r){return r.json();})
      .then(function(d){
        box.innerHTML="";
        if(d.error){box.innerHTML='<div class="yt-empty">No se pudo buscar. Revisa la clave o la cuota.</div>';return;}
        if(!d.items||!d.items.length){box.innerHTML='<div class="yt-empty">Sin resultados</div>';return;}
        d.items.forEach(function(it){
          if(!it.id||!it.id.videoId)return;
          var vid=it.id.videoId,sn=it.snippet;
          var row=document.createElement("button");row.className="yt-res";row.type="button";
          var im=document.createElement("img");im.src=(sn.thumbnails&&sn.thumbnails.default?sn.thumbnails.default.url:"");im.alt="";
          var tx=document.createElement("span");tx.textContent=sn.title||"";
          row.appendChild(im);row.appendChild(tx);
          row.addEventListener("click",function(){ytHostPlay(vid);});
          box.appendChild(row);
        });
      }).catch(function(){box.innerHTML='<div class="yt-empty">Error de conexión al buscar.</div>';});
  }

  // ---------- Consola de mezcla (volúmenes locales de escucha) ----------
  var dawListenVol=100, dawListenMuted=false, ytMuted=false;

  function applyVoiceListen(p){
    if(p.voiceAudio)p.voiceAudio.volume=p.voiceMuted?0:(p.voiceVol!=null?p.voiceVol:1);
  }
  function applyDawListen(){
    var v=dawListenMuted?0:dawListenVol/100;
    if(dawMonitorEl)dawMonitorEl.volume=v;
    Object.keys(peers).forEach(function(k){if(peers[k].dawAudio)peers[k].dawAudio.volume=v;});
  }
  function applyYtListen(){
    var v=ytMuted?0:ytVol;
    if(ytPlayer&&ytPlayer.setVolume)ytPlayer.setVolume(v);
  }
  function dawInRoom(){
    if(dawOn)return true;
    return Object.keys(peers).some(function(k){return peers[k].dawAudio;});
  }
  function ytInRoom(){return !!ytCurrentVideo;}

  var SPK_SVG='<svg viewBox="0 0 24 24"><path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg>';
  var MUTE_SVG='<svg viewBox="0 0 24 24"><path d="M11 5 6 9H2v6h4l5 4V5z"/><line x1="22" y1="9" x2="16" y2="15"/><line x1="16" y1="9" x2="22" y2="15"/></svg>';

  // Fader vertical personalizado (0–100), consistente en todos los navegadores
  function makeFader(initial,onChange){
    var el=document.createElement("div");el.className="fader";
    el.innerHTML='<div class="fader-track"><div class="fader-fill"></div></div><div class="fader-knob"></div>';
    var fill=el.querySelector(".fader-fill"),knob=el.querySelector(".fader-knob");
    var val=(initial!=null?initial:100);
    var KH=15, pad=KH/2;
    function paint(){
      var H=el.clientHeight||150, travel=H-KH;
      var center=pad+(val/100)*travel;      // altura del centro del cap, desde abajo
      fill.style.height=center+"px";
      knob.style.bottom=(center-pad)+"px";
    }
    function fromEvent(e){
      var r=el.getBoundingClientRect(), H=r.height, travel=H-KH;
      var center=Math.max(pad,Math.min(H-pad,r.bottom-e.clientY));
      val=Math.max(0,Math.min(100,Math.round((center-pad)/travel*100)));
      paint();onChange(val);
    }
    var dragging=false;
    el.addEventListener("pointerdown",function(e){dragging=true;try{el.setPointerCapture(e.pointerId);}catch(err){}fromEvent(e);});
    el.addEventListener("pointermove",function(e){if(dragging)fromEvent(e);});
    var end=function(){dragging=false;};
    el.addEventListener("pointerup",end);el.addEventListener("pointercancel",end);
    // pinta tras insertarse en el DOM (clientHeight ya disponible)
    requestAnimationFrame(paint);
    return {el:el,set:function(v){val=v;paint();}};
  }

  function makeChannel(opts){
    // opts: name, isSrc, value(0-100), muted, onVol(v), onMute(muted)
    var ch=document.createElement("div");ch.className="console-ch"+(opts.muted?" muted":"");
    var nm=document.createElement("div");nm.className="ch-name"+(opts.isSrc?" src":"");nm.textContent=opts.name;nm.title=opts.name;
    var mute=document.createElement("button");mute.className="ch-mute";mute.setAttribute("aria-label","Silenciar "+opts.name);
    mute.innerHTML=opts.muted?MUTE_SVG:SPK_SVG;
    var valEl=document.createElement("div");valEl.className="ch-val";valEl.textContent=opts.value+"%";
    var fader=makeFader(opts.value,function(v){valEl.textContent=v+"%";opts.onVol(v);});
    mute.addEventListener("click",function(){
      var m=!ch.classList.contains("muted");
      ch.classList.toggle("muted",m);
      mute.innerHTML=m?MUTE_SVG:SPK_SVG;
      opts.onMute(m);
    });
    ch.appendChild(nm);ch.appendChild(mute);ch.appendChild(fader.el);ch.appendChild(valEl);
    return ch;
  }

  function renderConsole(){
    var rack=$("consoleRack");if(!rack)return;
    rack.innerHTML="";
    var count=0;

    // Un canal de voz por cada participante remoto
    Object.keys(peers).forEach(function(k){
      var p=peers[k];
      rack.appendChild(makeChannel({
        name:displayName(p.name,p.index),
        value:Math.round((p.voiceVol!=null?p.voiceVol:1)*100),
        muted:!!p.voiceMuted,
        onVol:function(v){p.voiceVol=v/100;applyVoiceListen(p);},
        onMute:function(m){p.voiceMuted=m;applyVoiceListen(p);}
      }));
      count++;
    });

    // Canal del DAW (de quien lo comparta)
    if(dawInRoom()){
      rack.appendChild(makeChannel({
        name:"DAW",isSrc:true,
        value:dawListenVol,muted:dawListenMuted,
        onVol:function(v){dawListenVol=v;applyDawListen();},
        onMute:function(m){dawListenMuted=m;applyDawListen();}
      }));
      count++;
    }

    // Canal de YouTube
    if(ytInRoom()){
      rack.appendChild(makeChannel({
        name:"YouTube",isSrc:true,
        value:Math.round(ytVol),muted:ytMuted,
        onVol:function(v){ytVol=v;applyYtListen();},
        onMute:function(m){ytMuted=m;applyYtListen();}
      }));
      count++;
    }

    $("consoleEmpty").classList.toggle("hide",count>0);
    rack.style.display=count>0?"flex":"none";
  }
  function refreshConsole(){if($("consoleSheet").classList.contains("show"))renderConsole();}

  function openSheet(id){
    sheetIds.forEach(function(s){$(s).classList.toggle("show",s===id);});
    $("scrim").classList.add("show");
  }
  function closeSheets(){
    if($("prejoinSheet").classList.contains("show"))cancelPrejoin();
    sheetIds.forEach(function(s){$(s).classList.remove("show");});
    $("scrim").classList.remove("show");
  }

  // ---------- salas personales y guardadas ----------
  function loadRooms(k){try{return JSON.parse(localStorage.getItem(k)||"[]");}catch(e){return [];}}
  function storeRooms(k,v){try{localStorage.setItem(k,JSON.stringify(v));}catch(e){}}
  function genId(){return (window.crypto&&crypto.randomUUID)?crypto.randomUUID():"r-"+Math.random().toString(36).slice(2)+Date.now().toString(36);}
  function parseRoomLink(text){
    text=(text||"").trim();
    var h=text.indexOf("#")>=0?text.slice(text.indexOf("#")+1):text;
    if(!h)return null;
    var parts=h.split("&n=");
    return {id:parts[0],name:parts[1]?decodeURIComponent(parts[1]):""};
  }
  function openHostPrejoin(customId,roomName){
    pendingJoin="host";role="host";
    hostCustomId=customId||null;hostRoomName=roomName||"";
    initHostPeer();
    $("preSaveRow").style.display="none";
    $("preSavedNote").style.display="none";
    $("prejoinTitle").textContent=roomName||"Antes de entrar";
    $("prejoinGo").textContent=roomName?("Abrir "+roomName):"Iniciar sala";
    openSheet("prejoinSheet");
    if(preMicOn)startMicPreview();
    if(preCamOn)startCamPreview();
  }
  function openGuestPrejoin(id,name){
    pendingJoin=id;joinRoomName=name||"";
    var saved=loadRooms("savedRooms").some(function(r){return r.id===id;});
    var mine=loadRooms("myRooms").some(function(r){return r.id===id;});
    var offer=!!name&&!saved&&!mine;
    $("prejoinTitle").textContent=name||"Antes de entrar";
    preSaveOn=false;$("preSaveSw").classList.remove("on");
    $("preSaveRow").style.display=offer?"flex":"none";
    $("preSaveName").textContent='Lo encontrarás en Inicio, opción \u201CUnirme\u201D';
    $("preSavedNote").style.display=(name&&(saved||mine))?"block":"none";
    $("prejoinGo").textContent="Entrar a la sala";
    openSheet("prejoinSheet");
    if(preMicOn)startMicPreview();
    if(preCamOn)startCamPreview();
  }
  function roomRow(room,actionLabel,onAction,onDelete){
    var row=document.createElement("div");row.className="person";
    var nm=document.createElement("span");nm.className="person-name";nm.textContent=room.name;
    var del=document.createElement("button");del.className="row-del";del.textContent="\u2715";del.setAttribute("aria-label","Eliminar");
    del.addEventListener("click",onDelete);
    var act=document.createElement("button");act.className="req-accept";act.textContent=actionLabel;
    act.addEventListener("click",onAction);
    row.appendChild(nm);row.appendChild(del);row.appendChild(act);
    return row;
  }
  function renderMyRooms(){
    var rooms=loadRooms("myRooms"),list=$("myRoomsList");list.innerHTML="";
    $("myRoomsEmpty").style.display=rooms.length?"none":"block";
    rooms.forEach(function(r){
      list.appendChild(roomRow(r,"Abrir",
        function(){openHostPrejoin(r.id,r.name);},
        function(){storeRooms("myRooms",loadRooms("myRooms").filter(function(x){return x.id!==r.id;}));renderMyRooms();}
      ));
    });
  }
  function renderSavedRooms(){
    var rooms=loadRooms("savedRooms"),list=$("savedRoomsList");list.innerHTML="";
    $("savedRoomsEmpty").style.display=rooms.length?"none":"block";
    rooms.forEach(function(r){
      list.appendChild(roomRow(r,"Entrar",
        function(){openGuestPrejoin(r.id,r.name);},
        function(){storeRooms("savedRooms",loadRooms("savedRooms").filter(function(x){return x.id!==r.id;}));renderSavedRooms();}
      ));
    });
  }

  // ---------- wiring ----------
  document.addEventListener("DOMContentLoaded",function(){
    $("faqBtn").addEventListener("click",function(){closeSheets();$("faqPage").hidden=false;});
    $("faqClose").addEventListener("click",function(){$("faqPage").hidden=true;});
    $("themeBtn").addEventListener("click",function(){applyTheme(document.documentElement.getAttribute("data-theme")!=="dark");});
    $("startBtn").addEventListener("click",function(){openHostPrejoin(null,"");});
    $("myRoomsBtn").addEventListener("click",function(){renderMyRooms();openSheet("myRoomsSheet");});
    $("joinBtn").addEventListener("click",function(){renderSavedRooms();openSheet("joinSheet");});
    $("createRoomBtn").addEventListener("click",function(){
      var name=$("newRoomName").value.trim();
      if(!name){toast("Ponle un nombre a tu sala");return;}
      var rooms=loadRooms("myRooms");
      rooms.push({id:genId(),name:name});
      storeRooms("myRooms",rooms);
      $("newRoomName").value="";
      renderMyRooms();
      toast('Sala "'+name+'" creada');
    });
    $("joinLinkBtn").addEventListener("click",function(){
      var pl=parseRoomLink($("joinLinkInput").value);
      if(!pl||!pl.id){toast("Ese enlace no parece válido");return;}
      $("joinLinkInput").value="";
      openGuestPrejoin(pl.id,pl.name);
    });
    $("preSaveRow").addEventListener("click",function(){preSaveOn=!preSaveOn;$("preSaveSw").classList.toggle("on",preSaveOn);});
    $("preMicRow").addEventListener("click",function(){preMicOn=!preMicOn;$("preMicSw").classList.toggle("on",preMicOn);ensureCtx();if(preMicOn)startMicPreview();else stopMicPreview();});
    $("preCamRow").addEventListener("click",function(){preCamOn=!preCamOn;$("preCamSw").classList.toggle("on",preCamOn);if(preCamOn)startCamPreview();else stopCamPreview();});
    $("prejoinGo").addEventListener("click",function(){
      micOn=preMicOn;camOn=preCamOn;
      stopMicPreview();stopCamPreview();
      if(pendingJoin&&pendingJoin!=="host"&&preSaveOn&&joinRoomName){
        var sr=loadRooms("savedRooms");
        if(!sr.some(function(x){return x.id===pendingJoin;})){sr.push({id:pendingJoin,name:joinRoomName});storeRooms("savedRooms",sr);toast('Sala "'+joinRoomName+'" guardada');}
      }
      var go=pendingJoin;pendingJoin=null; // evita que closeSheets aborte
      sheetIds.forEach(function(s){$(s).classList.remove("show");});
      $("scrim").classList.remove("show");
      if(go==="host")startHost();
      else if(go)joinGuest(go);
    });

    var copyFn=function(inputId,btnId){
      var i=$(inputId);i.select();i.setSelectionRange(0,99999);
      var ok=function(){var b=$(btnId);b.textContent="Copiado";b.classList.add("ok");setTimeout(function(){b.textContent="Copiar";b.classList.remove("ok");},1600);};
      if(navigator.clipboard)navigator.clipboard.writeText(i.value).then(ok,ok);else{document.execCommand("copy");ok();}
    };
    $("copyBtn").addEventListener("click",function(){copyFn("shareLink","copyBtn");});
    $("copyBtn2").addEventListener("click",function(){copyFn("shareLink2","copyBtn2");});

    $("micCtrl").addEventListener("click",toggleMic);
    $("screenCtrl").addEventListener("click",toggleScreen);
    $("consoleCtrl").addEventListener("click",function(){openSheet("consoleSheet");renderConsole();});
    $("toolsCtrl").addEventListener("click",function(){openSheet("toolsSheet");});
    $("toolDaw").addEventListener("click",function(){toggleDaw();});
    $("toolYouTube").addEventListener("click",function(){closeSheets();openYTPanel();ensureYTPlayer(function(){});setTimeout(function(){var q=$("ytQuery");if(q)q.focus();},150);});
    $("ytClose").addEventListener("click",closeYTPanel);
    $("ytPanelVol").addEventListener("input",function(){ytVol=+this.value;ytMuted=false;applyYtListen();refreshConsole();});
    (function(){
      var panel=$("ytPanel"),handle=panel.querySelector(".yt-head");
      var drag=false,sx,sy,ox,oy;
      handle.addEventListener("pointerdown",function(e){
        if(e.target.closest(".yt-x"))return;
        drag=true;var r=panel.getBoundingClientRect();
        panel.style.left=r.left+"px";panel.style.top=r.top+"px";panel.style.right="auto";panel.style.bottom="auto";
        sx=e.clientX;sy=e.clientY;ox=r.left;oy=r.top;
        try{handle.setPointerCapture(e.pointerId);}catch(err){}
        handle.style.cursor="grabbing";
      });
      handle.addEventListener("pointermove",function(e){
        if(!drag)return;
        var nx=ox+(e.clientX-sx),ny=oy+(e.clientY-sy);
        nx=Math.max(0,Math.min(nx,window.innerWidth-panel.offsetWidth));
        ny=Math.max(0,Math.min(ny,window.innerHeight-panel.offsetHeight));
        panel.style.left=nx+"px";panel.style.top=ny+"px";
      });
      handle.addEventListener("pointerup",function(){drag=false;handle.style.cursor="grab";});
      handle.addEventListener("pointercancel",function(){drag=false;handle.style.cursor="grab";});
    })();
    $("ytQuery").addEventListener("input",function(){
      var v=this.value;if(ytSearchTimer)clearTimeout(ytSearchTimer);
      ytSearchTimer=setTimeout(function(){ytSearch(v);},350);
    });
    $("camCtrl").addEventListener("click",toggleCam);
    $("peopleCtrl").addEventListener("click",function(){openSheet("peopleSheet");});
    $("reqCtrl").addEventListener("click",function(){openSheet("reqSheet");});
    $("gearCtrl").addEventListener("click",function(){openSheet("sheet");});
    $("hangCtrl").addEventListener("click",hangUp);
    $("scrim").addEventListener("click",closeSheets);
    document.querySelectorAll(".sheet-x").forEach(function(b){b.addEventListener("click",closeSheets);});

    $("inScreenRow").addEventListener("click",toggleScreen);
    $("inDawRow").addEventListener("click",toggleDaw);

    $("micSelect").addEventListener("change",function(){selMic=this.value;$("srcName").textContent=this.selectedOptions[0].textContent;reacquireMic().catch(function(){toast("No se pudo cambiar el micrófono");});});
    $("dawSelect").addEventListener("change",function(){
      selDaw=this.value;
      var d=this.selectedOptions[0];$("inDawName").textContent=selDaw&&d?d.textContent:"Sin dispositivo";
      if(!selDaw){if(dawOn)stopDaw();return;}
      if(dawOn){stopDaw();startDaw();} else {startDaw();closeSheets();}
    });
    $("camSelect").addEventListener("change",function(){selCam=this.value;swapCamera().catch(function(){toast("No se pudo cambiar la cámara");});});
    $("spkSelect").addEventListener("change",function(){selSpk=this.value;applySinkAll();});
    $("musicRow").addEventListener("click",function(){musicMode=!musicMode;$("musicSw").classList.toggle("on",musicMode);reacquireMic().then(function(){toast(musicMode?"Modo música activado":"Modo música desactivado");}).catch(function(){});});

    // ganancia del DAW (card + ajustes, sincronizados)
    function setDawGain(pct){
      pct=Math.max(0,Math.min(400,Math.round(pct)));
      dawGain=pct/100;
      if(dawNodes)dawNodes.gain.gain.value=dawGain;
      ["dawGainSlider","dawGainSlider2"].forEach(function(id){var el=$(id);if(el&&+el.value!==pct)el.value=pct;});
      ["dawGainVal","dawGainVal2"].forEach(function(id){var el=$(id);if(el)el.textContent=pct+"%";});
      localStorage.setItem("dawGain",String(dawGain));
    }
    setDawGain(dawGain*100);
    ["dawGainSlider","dawGainSlider2"].forEach(function(id){
      var el=$(id);if(el)el.addEventListener("input",function(){setDawGain(this.value);});
    });

    // EQ de audífonos
    if($("eqSw")){
      $("eqSw").classList.toggle("on",eqOn);
      if(eqModel){var es=$("eqSearch");if(es)es.value=eqModel;}
      updateEqCurrent();
      if(eqOn&&eqModel)loadEqCatalog(eqRebuildAll);
      $("eqRow").addEventListener("click",function(ev){
        if(ev.target.closest("#eqPicker"))return;
        eqOn=!eqOn;try{localStorage.setItem("eqOn",eqOn?"1":"0");}catch(e){}
        $("eqSw").classList.toggle("on",eqOn);
        if(eqOn&&!eqModel){var s=$("eqSearch");if(s)s.focus();toast("Busca y elige tu modelo de audífonos");}
        eqRebuildAll();
      });
      $("eqSearch").addEventListener("focus",function(){loadEqCatalog();if(this.value)renderEqResults(this.value);});
      $("eqSearch").addEventListener("input",function(){renderEqResults(this.value);});
    }

    // perfil
    $("nameInput").addEventListener("input",function(){
      myName=this.value.slice(0,24);
      try{localStorage.setItem("myName",myName);}catch(e){}
      updatePeersUI();broadcast(myProfileMsg());
    });
    $("myAvatar").addEventListener("click",function(){$("avatarFile").click();});
    $("avatarFile").addEventListener("change",function(){if(this.files&&this.files[0])setAvatarFromFile(this.files[0]);this.value="";});

    if(navigator.mediaDevices&&navigator.mediaDevices.addEventListener){
      navigator.mediaDevices.addEventListener("devicechange",function(){populateDevices();});
    }

    watchAspect($("meVideo"));

    var hash=location.hash.replace(/^#/,"");
    if(hash){var pl=parseRoomLink(hash);if(pl&&pl.id)openGuestPrejoin(pl.id,pl.name);}
  });
})();
