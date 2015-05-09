

(function (window, angular) {
    'use strict';
    /* jshint eqnull:true */
    /* jshint -W038 */

    // DESCRIPTION:
    // vsRepeat directive stands for Virtual Scroll Repeat. It turns a standard ngRepeated set of elements in a scrollable container
    // into a component, where the user thinks he has all the elements rendered and all he needs to do is scroll (without any kind of
    // pagination - which most users loath) and at the same time the browser isn't overloaded by that many elements/angular bindings etc.
    // The directive renders only so many elements that can fit into current container's clientHeight/clientWidth.

    // LIMITATIONS:
    // - current version only supports an Array as a right-hand-side object for ngRepeat
    // - all rendered elements must have the same height/width or the sizes of the elements must be known up front

    // USAGE:
    // In order to use the vsRepeat directive you need to place a vs-repeat attribute on a direct parent of an element with ng-repeat
    // example:
    // <div vs-repeat>
    //		<div ng-repeat="item in someArray">
    //			<!-- content -->
    //		</div>
    // </div>
    // 
    // You can also measure the single element's height/width (including all paddings and margins), and then speficy it as a value
    // of the attribute 'vs-repeat'. This can be used if one wants to override the automatically computed element size.
    // example:
    // <div vs-repeat="50"> <!-- the specified element height is 50px -->
    //		<div ng-repeat="item in someArray">
    //			<!-- content -->
    //		</div>
    // </div>
    // 
    // IMPORTANT! 
    // 
    // - the vsRepeat directive must be applied to a direct parent of an element with ngRepeat
    // - the value of vsRepeat attribute is the single element's height/width measured in pixels. If none provided, the directive
    //		will compute it automatically

    // OPTIONAL PARAMETERS (attributes):
    // vs-scroll-parent="selector" - selector to the scrollable container. The directive will look for a closest parent matching
    //								he given selector (defaults to the current element)
    // vs-horizontal - stack repeated elements horizontally instead of vertically
    // vs-offset-before="value" - top/left offset in pixels (defaults to 0)
    // vs-offset-after="value" - bottom/right offset in pixels (defaults to 0)
    // vs-excess="value" - an integer number representing the number of elements to be rendered outside of the current container's viewport
    //						(defaults to 2)
    // vs-size-property - a property name of the items in collection that is a number denoting the element size (in pixels)
    // vs-autoresize - use this attribute without vs-size-property and without specifying element's size. The automatically computed element style will
    //				readjust upon window resize if the size is dependable on the viewport size

    // EVENTS:
    // - 'vsRepeatTrigger' - an event the directive listens for to manually trigger reinitialization
    // - 'vsRepeatReinitialized' - an event the directive emits upon reinitialization done

    var isMacOS = navigator.appVersion.indexOf('Mac') != -1,
		wheelEventName = typeof window.onwheel !== 'undefined' ? 'wheel' : typeof window.onmousewheel !== 'undefined' ? 'mousewheel' : 'DOMMouseScroll',
		dde = document.documentElement,
		matchingFunction = dde.matches ? 'matches' :
							dde.matchesSelector ? 'matchesSelector' :
							dde.webkitMatches ? 'webkitMatches' :
							dde.webkitMatchesSelector ? 'webkitMatchesSelector' :
							dde.msMatches ? 'msMatches' :
							dde.msMatchesSelector ? 'msMatchesSelector' :
							dde.mozMatches ? 'mozMatches' :
							dde.mozMatchesSelector ? 'mozMatchesSelector' : null;

    var closestElement = angular.element.prototype.closest || function (selector) {
        var el = this[0].parentNode;
        while (el !== document.documentElement && el != null && !el[matchingFunction](selector)) {
            el = el.parentNode;
        }

        if (el && el[matchingFunction](selector))
            return angular.element(el);
        else
            return angular.element();
    };

    angular.module('vs-repeat', []).directive('vsRepeat', ['$compile', '$timeout', 'safeApply', function ($compile, $timeout, safeApply) {
        return {
            restrict: 'A',
            scope: true,
            require: '?^vsRepeat',
            controller: ['$scope', function ($scope) {
                this.$scrollParent = $scope.$scrollParent;
                this.$fillElement = $scope.$fillElement;
            }],
            compile: function ($element, $attrs) {
                var ngRepeatChild = $element.children().eq(0),
					ngRepeatExpression = ngRepeatChild.attr('ng-repeat'),
					childCloneHtml = ngRepeatChild[0].outerHTML,
					expressionMatches = /^\s*(\S+)\s+in\s+([\S\s]+?)(track\s+by\s+\S+)?$/.exec(ngRepeatExpression),
					lhs = expressionMatches[1],
					rhs = expressionMatches[2],
					rhsSuffix = expressionMatches[3],
					collectionName = '$vs_collection',
					attributesDictionary = {
					    'vsRepeat': 'elementSize',
					    'vsOffsetBefore': 'offsetBefore',
					    'vsOffsetAfter': 'offsetAfter',
					    'vsExcess': 'excess',
					    'vsTileView': 'tileView',
					    'vsAnimationEnable': 'vsAnimationEnable'
					};

                $element.empty();
                if (!window.getComputedStyle || window.getComputedStyle($element[0]).position !== 'absolute')
                    $element.css('position', 'relative');
                return {
                    pre: function ($scope, $element, $attrs, $ctrl) {
                        var childClone = angular.element(childCloneHtml),
							originalCollection = [],
							originalLength,
							$$horizontal = typeof $attrs.vsHorizontal !== "undefined",
							$wheelHelper,
							$fillElement,
							autoSize = !$attrs.vsRepeat,
                            elementOnRow = $attrs.vsElementOnRow ? parseInt($attrs.vsElementOnRow, 10) : 1,
							sizesPropertyExists = !!$attrs.vsSizeProperty,
							$scrollParent = $attrs.vsScrollParent ? closestElement.call($element, $attrs.vsScrollParent) : $element,
							positioningPropertyTransform = $$horizontal ? 'translateX' : 'translateY',
							positioningProperty = $$horizontal ? 'left' : 'top',

							clientSize = $$horizontal ? 'clientWidth' : 'clientHeight',
							offsetSize = $$horizontal ? 'offsetWidth' : 'offsetHeight',
							scrollPos = $$horizontal ? 'scrollLeft' : 'scrollTop',
							animate = true;

                        $scope.isIE9 = window.navigator.appVersion.indexOf('MSIE 9.0') ? true : false;

                        $scope.childWidth = 0;
                        $scope.childHeight = 0;
                        $scope.scrollTop = 0;
                        $scope.containerHeight = 0;
                        $scope.containerWidth = 0;
                        $scope.lastScroll = 0;


                        $scope.tileView = $attrs.vsTileView;


                        $scope.currentElemDetailsRowLastElemIndex = -1;

                        $scope.elementOnRow = elementOnRow;
                        $scope.detailSelector = '';
                        $scope.detailsContainer = null;

                        if ($scrollParent.length === 0) throw 'Specified scroll parent selector did not match any element';
                        $scope.$scrollParent = $scrollParent;

                        if (sizesPropertyExists) $scope.sizesCumulative = [];

                        //initial defaults
                        $scope.elementSize = $scrollParent[0][clientSize] || 50;
                        $scope.offsetBefore = 0;
                        $scope.offsetAfter = 0;
                        $scope.excess = 0;

                        function hideItems() {
                            if ($scope.isIE9) {
                                $('#obj-list-container>ul>li').css('opacity', '0');
                            }
                        }

                        function showItems() {
                            if ($scope.isIE9) {
                                var $elements = $('#obj-list-container>ul>li');

                                $elements.animate({
                                    opacity: 1
   
                                }, 500);

                            }
                        }

                        Object.keys(attributesDictionary).forEach(function (key) {
                            if ($attrs[key]) {
                                $attrs.$observe(key, function (value) {
                                    if (isNaN(parseInt(value))) {
                                        $scope[attributesDictionary[key]] = value;
                                        if (key == "vsTileView" && value) {
                                            var timer = 500;
                                            if ($scope.scrollTop > 0) {
                                                timer = 0;
                                            }
                                            $scrollParent.scrollTop(0); //Scroll container to the top.
                                            hideItems();
                                            $scope.animate = "zoomOut";
                                            if (value == "true") {
                                                $scope.elementOnRow = $attrs.vsElementOnRow ? parseInt($attrs.vsElementOnRow, 10) : 1;
                                            }
                                            else
                                            {
                                                 $scope.elementOnRow  = 1;
                                            }
                                            safeApply($scope);
                                            setTimeout(function () {
                                                onWindowResize(true);
                                            }, timer);
                                            return;
                                        }
                                    }
                                    else {
                                        $scope[attributesDictionary[key]] = +value;
                                    }
                                    reinitialize();
                                });
                            }
                        });

                        $scope.$watchCollection(rhs, function (coll,oldValue) {
                            originalCollection = coll || [];
                            if (!originalCollection || originalCollection.length < 1) {
                                $scope[collectionName] = [];
                                originalLength = 0;
                                resizeFillElement(0);
                                $scope.sizesCumulative = [0];
                                return;
                            }
                            else {
                                originalLength = originalCollection.length;
                                if (sizesPropertyExists) {
                                    $scope.sizes = originalCollection.map(function (item) {
                                        return item[$attrs.vsSizeProperty];
                                    });
                                    var sum = 0;
                                    $scope.sizesCumulative = $scope.sizes.map(function (size) {
                                        var res = sum;
                                        sum += size;
                                        return res;
                                    });
                                    $scope.sizesCumulative.push(sum);
                                }
                                setAutoSize();
                            }
                            reinitialize();
                        });

                        function setAutoSize() {
                            if (autoSize) {
                                $scope.$$postDigest(function () {
                                    if ($element[0].offsetHeight || $element[0].offsetWidth) { // element is visible
                                        var children = $element.children(),
											i = 0;
                                        while (i < children.length) {
                                            if (children[i].attributes['ng-repeat'] != null) {
                                                if (children[i][offsetSize]) {
                                                    $scope.elementSize = children[i][offsetSize];
                                                    if ($scope.tileView == 'true') {
                                                       // $scope.childWidth = parseInt(children[0]['offsetWidth'], 10) + parseInt(children[0].offsetLeft, 10);
                                                        // $scope.childHeight = parseInt(children[0]['offsetHeight'], 10) + parseInt(children[0].offsetTop, 10);
                                                        $scope.childHeight = children.outerHeight(true);
                                                        $scope.childWidth = children.outerWidth(true);
                                                        $scope.containerHeight = $element[0].offsetHeight;
                                                        $scope.containerWidth = $element[0].offsetWidth;
                                                        elementOnRow = $attrs.vsElementOnRow ? parseInt($attrs.vsElementOnRow, 10) : Math.floor($element[0].offsetWidth / $scope.childWidth);
                                                        $scope.elementOnRow = elementOnRow;

                                                        //console.log("Element :" + elementOnRow);
                                                    }
                                                    else if (!$$horizontal) {
                                                        $scope.elementSize = $scope.elementSize + parseInt(window.getComputedStyle(children[i]).marginBottom, 10);
                                                        $scope.childHeight = $scope.elementSize;
                                                       // $scope.elementOnRow = $attrs.vsElementOnRow ? parseInt($attrs.vsElementOnRow, 10) : 1;
                                                         $scope.elementOnRow = 1;
                                                    }
                                                    else if ($$horizontal) {
                                                        $scope.elementSize = $scope.elementSize + parseInt(children[0].offsetLeft, 10);
                                                    }
                                                    reinitialize();
                                                    autoSize = false;
                                                    if ($scope.$root && !$scope.$root.$$phase)
                                                        //$scope.$apply();
                                                        $scope.$digest();
                                                }
                                                break;
                                            }
                                            i++;
                                        }
                                    }
                                    else {
                                        var dereg = $scope.$watch(function () {
                                            if ($element[0].offsetHeight || $element[0].offsetWidth) {
                                                dereg();
                                                setAutoSize();
                                            }
                                        });
                                    }
                                });
                            }
                        }

                        childClone.attr('ng-repeat', lhs + ' in ' + collectionName + (rhsSuffix ? ' ' + rhsSuffix : ''))
								.addClass('vs-repeat-repeated-element');

                        var offsetCalculationString = sizesPropertyExists ?
							'(sizesCumulative[$index + startIndex] + offsetBefore)' :
							'(($index + startIndex) * elementSize + offsetBefore)';

                        $scope.Math = window.Math;



                        var transformProperty = "translate",
                            offsetX = '((($index + startIndex) % elementOnRow) * childWidth)',
                            offsetY = '(Math.floor(($index + startIndex) / elementOnRow) * childHeight)';

                        if (($attrs.vsAnimationEnable == 'true')) {
                            childClone.attr('ng-class', '{animated:true,zoomIn:(animate == "zoomIn") ,zoomOut:(animate == "zoomOut") , zeroOpacity:(isIE9 && animate == "zoomIn"),zeroOpacity:(animate == "zeroOpacity")}');
                           
                        }
                        //Common for tile & list view.
                        childClone.attr('ng-style', '{top:' + offsetY + '+"px", left:' + offsetX + '+"px"}');


                        $compile(childClone)($scope);
                        $element.append(childClone);

                        $fillElement = angular.element('<div class="vs-repeat-fill-element"></div>')
							.css({
							    'position': 'relative',
							    'min-height': '100%',
							    'min-width': '100%'
							});
                        $element.append($fillElement);
                        $compile($fillElement)($scope);
                        $scope.$fillElement = $fillElement;

                        var _prevMouse = {};
                        if (isMacOS) {
                            $wheelHelper = angular.element('<div class="vs-repeat-wheel-helper"></div>')
								.on(wheelEventName, function (e) {
								    e.preventDefault();
								    e.stopPropagation();
								    if (e.originalEvent) e = e.originalEvent;
								    $scrollParent[0].scrollLeft += (e.deltaX || -e.wheelDeltaX);
								    $scrollParent[0].scrollTop += (e.deltaY || -e.wheelDeltaY);
								}).on('mousemove', function (e) {
								    if (_prevMouse.x !== e.clientX || _prevMouse.y !== e.clientY)
								        angular.element(this).css('display', 'none');
								    _prevMouse = {
								        x: e.clientX,
								        y: e.clientY
								    };
								}).css('display', 'none');
                            $fillElement.append($wheelHelper);
                        }

                        $scope.startIndex = 0;
                        $scope.endIndex = 0;
                        var scrollTimer = 0;
                        $scrollParent.on('scroll', function scrollHandler(e) {
                            clearTimeout(scrollTimer);
                            scrollTimer = setTimeout(function () {
                                animate = false;
                                $scope.scrollTop = $scrollParent[0][scrollPos];
                                if (updateInnerCollection())
                                    //$scope.$apply();
                                    $scope.$digest();
                            }, 0);
                        });

                        if (isMacOS) {
                            $scrollParent.on(wheelEventName, wheelHandler);
                        }
                        function wheelHandler(e) {
                            var elem = e.currentTarget;
                            if (elem.scrollWidth > elem.clientWidth || elem.scrollHeight > elem.clientHeight)
                                $wheelHelper.css('display', 'block');
                        }

                        function onWindowResize(animation) {
                            if (!animation) {
                                animate = false;
                            }
                            else {
                                animate = true;
                            }
                            if (typeof $attrs.vsAutoresize !== 'undefined') {
                                autoSize = true;
                                setAutoSize();
                                if ($scope.$root && !$scope.$root.$$phase)
                                    //  $scope.$apply();
                                    $scope.$digest();
                            }
                            if (updateInnerCollection())
                                // $scope.$apply();
                                $scope.$digest();
                        }

                        angular.element(window).on('resize', onWindowResize);
                        $scope.$on('$destroy', function () {
                            angular.element(window).off('resize', onWindowResize);
                        });

                        $scope.$on('vsRepeatTrigger', reinitialize);
                        $scope.$on('vsRepeatResize', function () {
                            
                            autoSize = true;
                            setAutoSize();
                        });

                        var _prevStartIndex,
							_prevEndIndex;
                        function reinitialize() {
                            _prevStartIndex = void 0;
                            _prevEndIndex = void 0;
                            updateInnerCollection();
                            if ($scope.tileView == 'true') {
                                resizeFillElement(sizesPropertyExists ?
                                                    $scope.sizesCumulative[originalLength] :
                                                    (($scope.childHeight ? $scope.childHeight : $scope.elementSize) * Math.ceil(originalLength / elementOnRow))
                                                );
                            }
                            else {
                                resizeFillElement(sizesPropertyExists ?
												$scope.sizesCumulative[originalLength] :
												$scope.elementSize * originalLength
											);
                            }
                            $scope.$emit('vsRepeatReinitialized');
                        }

                        function resizeFillElement(size) {
                            if ($$horizontal) {
                                $fillElement.css({
                                    'width': $scope.offsetBefore + size + $scope.offsetAfter + 'px',
                                    'height': '100%'
                                });
                                if ($ctrl && $ctrl.$fillElement) {
                                    var referenceElement = $ctrl.$fillElement[0].parentNode.querySelector('[ng-repeat]');
                                    if (referenceElement)
                                        $ctrl.$fillElement.css({
                                            'width': referenceElement.scrollWidth + 'px'
                                        });
                                }
                            }
                            else {
                                $fillElement.css({
                                    'height': $scope.offsetBefore + size + $scope.offsetAfter + 'px',
                                    'width': '100%'
                                });
                                if ($ctrl && $ctrl.$fillElement) {
                                    referenceElement = $ctrl.$fillElement[0].parentNode.querySelector('[ng-repeat]');
                                    if (referenceElement)
                                        $ctrl.$fillElement.css({
                                            'height': referenceElement.scrollHeight + 'px'
                                        });
                                }
                            }
                        }

                        var _prevClientSize;
                        function reinitOnClientHeightChange() {
                            var ch = $scrollParent[0][clientSize];
                            if (ch !== _prevClientSize) {
                                animate = false;
                                reinitialize();
                                if ($scope.$root && !$scope.$root.$$phase)
                                    //$scope.$apply();
                                    $scope.$digest();
                            }
                            _prevClientSize = ch;
                        }

                        $scope.$watch(function () {
                            if (typeof window.requestAnimationFrame === "function")
                                window.requestAnimationFrame(reinitOnClientHeightChange);
                            else
                                reinitOnClientHeightChange();
                        });

                        function updateInnerCollection() {
                            if (sizesPropertyExists) {
                                $scope.startIndex = 0;
                                while ($scope.sizesCumulative[$scope.startIndex] < $scrollParent[0][scrollPos] - $scope.offsetBefore)
                                    $scope.startIndex++;
                                if ($scope.startIndex > 0) $scope.startIndex--;

                                $scope.endIndex = $scope.startIndex;
                                while ($scope.sizesCumulative[$scope.endIndex] < $scrollParent[0][scrollPos] - $scope.offsetBefore + $scrollParent[0][clientSize])
                                    $scope.endIndex++;
                            }
                            else {
                                $scope.excess = elementOnRow;
                                if ($scope.tileView == 'true') {
                                    $scope.startIndex = Math.max(
                                        Math.floor(
                                            Math.floor(($scrollParent[0][scrollPos] - $scope.offsetBefore) / ($scope.childHeight ? $scope.childHeight : $scope.elementSize)) * elementOnRow
                                        ),
                                        0
                                    );

                                    $scope.endIndex = Math.min(
                                        $scope.startIndex + (Math.ceil(
                                            ($scrollParent[0][clientSize] + $scope.offsetBefore) / ($scope.childHeight ? $scope.childHeight : $scope.elementSize)
                                        )) * elementOnRow + $scope.excess,
                                        originalLength
                                    );

                                    if (window.vsTimer) {
                                        window.clearInterval(window.vsTimer);
                                    }
                                    if (!$scope.childHeight && !$scope.childWidth) {
                                        window.vsTimer = window.setInterval(function () {
                                          
                                            if (!$scope.childHeight) {
                                                setAutoSize();
                                                safeApply($scope);
                                            }
                                            else {
                                                window.clearInterval(window.vsTimer);
                                            }
                                        }, 100);
                                    }



                                }
                                else {
                                    $scope.startIndex = Math.max(
									Math.floor(
										($scrollParent[0][scrollPos] - $scope.offsetBefore) / $scope.elementSize + $scope.excess / 2
									) - $scope.excess,
									0
								);
                                    $scope.endIndex = Math.min(
                                        $scope.startIndex + Math.ceil(
                                            ($scrollParent[0][clientSize] + $scope.offsetBefore) / $scope.elementSize
                                        ) + $scope.excess,
                                        originalLength
                                    );
                                }
                            }

                            var digestRequired = $scope.startIndex !== _prevStartIndex || $scope.endIndex !== _prevEndIndex;


                            if (digestRequired) {
                                if (animate) {
                                    $scope.animate = "zoomIn";
                                    $scope[collectionName] = originalCollection.slice($scope.startIndex, $scope.endIndex);
                                    
                                    hideItems();

                                    $scope.$$postDigest(function () {
                                        showItems();
                                    });

                                }
                                else {
                                    $scope.animate = "";
                                  
                                    $scope[collectionName] = originalCollection.slice($scope.startIndex, $scope.endIndex);
                                    animate = true;
                                }

                            }

                            _prevStartIndex = $scope.startIndex;
                            _prevEndIndex = $scope.endIndex;

                            return digestRequired;
                        }
                    }
                };
            }
        };
    }]);

    angular.element(document.head).append([
		'<style>' +
		'.vs-repeat-wheel-helper{' +
			'position: absolute;' +
			'top: 0;' +
			'bottom: 0;' +
			'left: 0;' +
			'right: 0;' +
			'z-index: 99999;' +
			'background: rgba(0, 0, 0, 0);' +
		'}' +
		'.vs-repeat-repeated-element{' +
			'position: absolute;' +
			'z-index: 1;' +
		'}' +
		'</style>'
    ].join(''));
})(window, window.angular);
